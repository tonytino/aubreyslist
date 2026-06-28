import { and, count, eq, max } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import { attestationValues, attestations, claims } from "~/db/schema";
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

/** A `confirm` / `dispute` vote, validated against the DB enum tuple. */
export const voteInputSchema = z.object({
  claimId: z.string().min(1, "claimId is required"),
  value: z.enum(attestationValues),
});
export type VoteInput = z.infer<typeof voteInputSchema>;

/** Retracting a vote needs only the claim — the actor is the current user. */
export const retractInputSchema = z.object({
  claimId: z.string().min(1, "claimId is required"),
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
 * Cast or change the current user's vote on a claim.
 *
 * Upserts against `attestations_claim_user_unique`: a first vote inserts; a
 * later vote by the same user on the same claim UPDATES the existing row's
 * `value` (and `updatedAt`) instead of inserting a duplicate — this is the
 * "one vote per user per claim, changeable" rule.
 *
 * After the upsert the claim's `lastConfirmedAt` is recomputed from the
 * surviving `confirm` rows (see {@link recomputeLastConfirmedAt}) so the
 * recency signal always reflects visible evidence: a confirm refreshes it, and
 * flipping a confirm to a dispute clears the now-withdrawn confirmation rather
 * than pinning recency to it (ADR-007).
 *
 * Login-gated: throws 401 for anonymous callers, then rate-limited per user via
 * {@link enforceWriteLimit} (issue #18; throws 429 on an abusive burst).
 */
export async function castVote(input: VoteInput): Promise<void> {
  const user = await requireCurrentUser();
  await enforceWriteLimit(user.id);

  const db = getDb();
  const now = new Date();

  await db
    .insert(attestations)
    .values({ claimId: input.claimId, userId: user.id, value: input.value })
    .onConflictDoUpdate({
      target: [attestations.claimId, attestations.userId],
      set: { value: input.value, updatedAt: now },
    });

  // Recency always tracks the surviving confirms — a confirm refreshes it, a
  // flip to dispute drops the withdrawn confirmation (ADR-007).
  await recomputeLastConfirmedAt(db, input.claimId);
}

/**
 * Retract the current user's vote on a claim — deletes their `attestations`
 * row. A no-op delete if no vote exists.
 *
 * After the delete the claim's `lastConfirmedAt` is recomputed from the
 * surviving `confirm` rows (see {@link recomputeLastConfirmedAt}): retracting
 * the only confirm drops recency to `null`, while retracting one of several
 * leaves it at the newest remaining confirm — recency stays derivable from
 * visible evidence (ADR-007).
 *
 * Login-gated: throws 401 for anonymous callers, then rate-limited per user via
 * {@link enforceWriteLimit} (issue #18; throws 429 on an abusive burst).
 */
export async function retractVote(input: RetractInput): Promise<void> {
  const user = await requireCurrentUser();
  await enforceWriteLimit(user.id);

  const db = getDb();

  await db
    .delete(attestations)
    .where(and(eq(attestations.claimId, input.claimId), eq(attestations.userId, user.id)));

  await recomputeLastConfirmedAt(db, input.claimId);
}

// The client-callable `createServerFn` wrappers (submitVote / removeVote /
// fetchClaimAggregate) live in `./attestations.fn.ts` (the `*.fn.ts`
// convention), so client code never imports this db-touching module — see the
// module docstring above.
