import { and, count, eq, max } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import { attestationValues, attestations, claimAttributes, claims } from "~/db/schema";
import { requireCurrentUser } from "~/server/auth/guards";
import { enforceWriteLimit } from "~/server/rate-limit";

/**
 * Claim confirm/dispute attestations — the WRITE + aggregate-signal layer
 * (issue #28, ADR-007 trust model).
 *
 * A signed-in user casts exactly **one** vote per claim — `confirm` or
 * `dispute` — and may change or retract it (domain.md, "One vote per user per
 * claim"). That rule is enforced at the DB level by the
 * `attestations_claim_user_unique` constraint on (`claim_id`, `user_id`):
 *
 * - **confirm / dispute** upsert via that constraint
 *   (`onConflictDoUpdate`) so a second vote by the same user UPDATES their
 *   existing row rather than inserting a duplicate; and
 * - **retract** DELETEs the user's row.
 *
 * Aggregate signal (ADR-007: a roll-up of *visible* evidence, never a secret
 * score): {@link getClaimAggregate} derives per-claim confirm/dispute counts
 * straight from the `attestations` rows and surfaces `claims.lastConfirmedAt`.
 * After every vote write `lastConfirmedAt` is recomputed as the newest
 * surviving `confirm` (null when none remain), so recency-driven staleness
 * always reflects visible evidence — a withdrawn confirm (flip to dispute or
 * retract) can never leave recency pinned to it (ADR-007).
 *
 * Scope: this module is the write + aggregate-helper layer only. The
 * transparent trust SUMMARY rendering and listing-detail wiring land in #29,
 * which consumes the typed {@link ClaimAggregate} helper exported here.
 *
 * Server-only: imports the DB client and the auth guards. Never import from
 * client code. Each public server function is login-gated via
 * {@link requireCurrentUser} (throws 401 for anonymous callers).
 *
 * Rate limiting (issue #18): these writes are user-driven mutations, so each
 * write entry point applies {@link enforceWriteLimit} once — immediately after
 * the {@link requireCurrentUser} auth gate and before any DB work — to cap an
 * abusive burst (throws 429). Reads ({@link getClaimAggregate}) are open and
 * unmetered.
 */

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * A `confirm` / `dispute` vote, addressed by `(listing, attribute)` rather than
 * a pre-existing `claimId` (#150). The claim row is created lazily on the first
 * vote for an attribute, so a user can begin attesting ANY of the 7 fixed
 * taxonomy attributes even on a listing with no claims yet. Both the attribute
 * (against the curated taxonomy) and the value (against the attestation enum)
 * are validated against the DB enum tuples.
 */
export const voteInputSchema = z.object({
  listingId: z.string().min(1, "listingId is required"),
  attribute: z.enum(claimAttributes),
  value: z.enum(attestationValues),
});
export type VoteInput = z.infer<typeof voteInputSchema>;

/**
 * Retracting a vote needs the `(listing, attribute)` slot — the actor is the
 * current user. A no-op when no claim row (and thus no vote) exists for the
 * slot.
 */
export const retractInputSchema = z.object({
  listingId: z.string().min(1, "listingId is required"),
  attribute: z.enum(claimAttributes),
});
export type RetractInput = z.infer<typeof retractInputSchema>;

/** Reading a claim's aggregate needs only the claim id. */
export const claimAggregateInputSchema = z.object({
  claimId: z.string().min(1, "claimId is required"),
});
export type ClaimAggregateInput = z.infer<typeof claimAggregateInputSchema>;

// ---------------------------------------------------------------------------
// Aggregate signal — a roll-up of visible evidence (ADR-007), never a score
// ---------------------------------------------------------------------------

/**
 * Per-claim aggregate the trust summary (#29) renders: the confirm/dispute
 * distribution plus recency. Every field is derivable from evidence the user
 * can also see — `confirmCount`/`disputeCount` are counts of the visible
 * `attestations` rows; `lastConfirmedAt` is the stored recency signal (null
 * until the first confirm).
 */
export interface ClaimAggregate {
  claimId: string;
  confirmCount: number;
  disputeCount: number;
  lastConfirmedAt: Date | null;
}

/**
 * Compute a claim's aggregate counts + recency directly from the database.
 *
 * Counts come from a single grouped scan of the claim's `attestations` rows
 * (no hidden score is stored or computed); `lastConfirmedAt` is read from the
 * `claims` row. A claim with no attestations yields zero counts.
 *
 * Visibility-aware (#41, ADR-007 "the summary is a roll-up of *visible*
 * evidence"): this is a PUBLIC, addressable read (every `createServerFn` is an
 * RPC mounted via `app/routes/api.$.ts`). A hidden/removed (or non-existent)
 * claim must NOT leak its trust roll-up, so we resolve the claim's
 * `moderationStatus` + recency FIRST and, for any non-`visible` or missing claim,
 * return the ZEROED/empty aggregate (treated as not-found) WITHOUT scanning its
 * attestations — never exposing the counts.
 */
export async function getClaimAggregate(input: ClaimAggregateInput): Promise<ClaimAggregate> {
  const db = getDb();

  // Resolve the claim's visibility + recency first; bail with a zeroed aggregate
  // for a non-visible or missing claim so a moderated-away claim's counts (and
  // its `lastConfirmedAt`) never reach the caller.
  const claimRows = await db
    .select({
      moderationStatus: claims.moderationStatus,
      lastConfirmedAt: claims.lastConfirmedAt,
    })
    .from(claims)
    .where(eq(claims.id, input.claimId))
    .limit(1);

  const claimRow = claimRows[0];
  if (!claimRow || claimRow.moderationStatus !== "visible") {
    return { claimId: input.claimId, confirmCount: 0, disputeCount: 0, lastConfirmedAt: null };
  }

  // Visible claim: one grouped scan for the confirm/dispute counts.
  const rows = await db
    .select({ value: attestations.value, n: count() })
    .from(attestations)
    .where(eq(attestations.claimId, input.claimId))
    .groupBy(attestations.value);

  let confirmCount = 0;
  let disputeCount = 0;
  for (const row of rows) {
    if (row.value === "confirm") confirmCount = row.n;
    else if (row.value === "dispute") disputeCount = row.n;
  }

  return {
    claimId: input.claimId,
    confirmCount,
    disputeCount,
    lastConfirmedAt: claimRow.lastConfirmedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Writes — upsert (confirm/dispute) and delete (retract), one vote per user
// ---------------------------------------------------------------------------

/**
 * Recompute a claim's `lastConfirmedAt` from its surviving `confirm` rows.
 *
 * ADR-007 requires recency to be derivable from *visible* evidence: the signal
 * must equal the newest still-present confirmation, never a stale value left
 * behind by a withdrawn confirm. We take `MAX(attestations.updatedAt)` over the
 * claim's `confirm` rows (the same `updatedAt` the upsert stamps) — mirroring
 * the grouped-scan style in {@link getClaimAggregate} — and set it to `null`
 * when no confirm rows remain. `claims.updatedAt` is bumped so the row's own
 * recency stays accurate. This is the single place that maintains the signal,
 * so every transition (flip, retract, re-confirm, dispute→confirm) is correct.
 */
async function recomputeLastConfirmedAt(
  db: ReturnType<typeof getDb>,
  claimId: string
): Promise<void> {
  const rows = await db
    .select({ lastConfirmedAt: max(attestations.updatedAt) })
    .from(attestations)
    .where(and(eq(attestations.claimId, claimId), eq(attestations.value, "confirm")));

  // `max()` over zero rows yields null — exactly the "no confirms" recency.
  const lastConfirmedAt = rows[0]?.lastConfirmedAt ?? null;

  await db
    .update(claims)
    .set({ lastConfirmedAt, updatedAt: new Date() })
    .where(eq(claims.id, claimId));
}

/**
 * Resolve the claim id for a `(listingId, attribute)` slot, CREATING the claim
 * row lazily if it does not exist yet (#150).
 *
 * The taxonomy is curated and fixed (domain.md): conceptually every listing has
 * all 7 attributes available, but a `claims` row is only materialized once
 * someone first attests an attribute. This keeps the write path the single
 * place that establishes a claim — no backfill, no empty rows for untouched
 * attributes.
 *
 * The insert is `onConflictDoNothing` on `claims_listing_attribute_unique`, so
 * a concurrent first vote on the same slot can never create a duplicate (the
 * unique constraint guarantees one claim per attribute per listing). We then
 * read the id back by `(listingId, attribute)` — which always resolves to the
 * single surviving row whether we inserted it or lost the race. Idempotent.
 */
async function resolveClaimId(
  db: ReturnType<typeof getDb>,
  listingId: string,
  attribute: VoteInput["attribute"]
): Promise<string | null> {
  // Upsert the claim slot atomically: insert when absent, no-op when present.
  await db
    .insert(claims)
    .values({ listingId, attribute })
    .onConflictDoNothing({ target: [claims.listingId, claims.attribute] });

  const rows = await db
    .select({ id: claims.id })
    .from(claims)
    .where(and(eq(claims.listingId, listingId), eq(claims.attribute, attribute)))
    .limit(1);

  return rows[0]?.id ?? null;
}

/**
 * Cast or change the current user's vote on a listing attribute (#150).
 *
 * The vote is addressed by `(listingId, attribute)`. The claim row is created
 * lazily on the first vote for an attribute via {@link resolveClaimId} (an
 * `onConflictDoNothing` upsert on `claims_listing_attribute_unique`), so a user
 * can begin attesting an attribute that has no claim row yet — the entry point
 * the core confirm/dispute loop was missing.
 *
 * Then the attestation upserts against `attestations_claim_user_unique`: a first
 * vote inserts; a later vote by the same user on the same claim UPDATES the
 * existing row's `value` (and `updatedAt`) instead of inserting a duplicate —
 * the "one vote per user per claim, changeable" rule, unchanged.
 *
 * After the upsert the claim's `lastConfirmedAt` is recomputed from the
 * surviving `confirm` rows (see {@link recomputeLastConfirmedAt}) so the
 * recency signal always reflects visible evidence: a confirm refreshes it, and
 * flipping a confirm to a dispute clears the now-withdrawn confirmation rather
 * than pinning recency to it (ADR-007) — identical to the prior behavior.
 *
 * Login-gated: throws 401 for anonymous callers, then rate-limited per user via
 * {@link enforceWriteLimit} (issue #18; throws 429 on an abusive burst), in that
 * order and BEFORE any DB work — the gate fires exactly once.
 */
export async function castVote(input: VoteInput): Promise<void> {
  const user = await requireCurrentUser();
  await enforceWriteLimit(user.id);

  const db = getDb();
  const now = new Date();

  const claimId = await resolveClaimId(db, input.listingId, input.attribute);
  // The upsert above guarantees a row exists for the slot; narrow off the
  // theoretical `undefined` so the downstream writes are typed honestly.
  if (claimId === null) {
    throw new Error("Claim upsert returned no row.");
  }

  await db
    .insert(attestations)
    .values({ claimId, userId: user.id, value: input.value })
    .onConflictDoUpdate({
      target: [attestations.claimId, attestations.userId],
      set: { value: input.value, updatedAt: now },
    });

  // Recency always tracks the surviving confirms — a confirm refreshes it, a
  // flip to dispute drops the withdrawn confirmation (ADR-007).
  await recomputeLastConfirmedAt(db, claimId);
}

/**
 * Retract the current user's vote on a listing attribute (#150) — deletes their
 * `attestations` row for the `(listingId, attribute)` slot.
 *
 * A no-op when no claim row exists for the slot (nothing was ever attested, so
 * there is nothing to retract) — we never create a claim on a retract. When a
 * claim exists the delete is scoped to the current user's row, then the claim's
 * `lastConfirmedAt` is recomputed from the surviving `confirm` rows (see
 * {@link recomputeLastConfirmedAt}): retracting the only confirm drops recency
 * to `null`, while retracting one of several leaves it at the newest remaining
 * confirm — recency stays derivable from visible evidence (ADR-007).
 *
 * Login-gated: throws 401 for anonymous callers, then rate-limited per user via
 * {@link enforceWriteLimit} (issue #18; throws 429 on an abusive burst), in that
 * order and BEFORE any DB work.
 */
export async function retractVote(input: RetractInput): Promise<void> {
  const user = await requireCurrentUser();
  await enforceWriteLimit(user.id);

  const db = getDb();

  // Resolve the existing claim WITHOUT creating one — a retract on a never-
  // attested slot is a no-op (no row to delete, no recency to recompute).
  const existing = await db
    .select({ id: claims.id })
    .from(claims)
    .where(and(eq(claims.listingId, input.listingId), eq(claims.attribute, input.attribute)))
    .limit(1);
  const claimId = existing[0]?.id;
  if (claimId === undefined) {
    return;
  }

  await db
    .delete(attestations)
    .where(and(eq(attestations.claimId, claimId), eq(attestations.userId, user.id)));

  await recomputeLastConfirmedAt(db, claimId);
}

// The client-callable `createServerFn` wrappers (submitVote / removeVote /
// fetchClaimAggregate) live in `./attestations.fn.ts` (the `*.fn.ts`
// convention), so client code never imports this db-touching module — see the
// module docstring above.
