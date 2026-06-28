import { createServerFn } from "@tanstack/react-start";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import { attestationValues, attestations, claims } from "~/db/schema";
import { requireCurrentUser } from "~/server/auth/guards";

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
 * A `confirm` bumps `lastConfirmedAt` to now so recency-driven staleness stays
 * current; dispute/retract leave it untouched (an old confirmation is still the
 * last time the claim was affirmed).
 *
 * Scope: this module is the write + aggregate-helper layer only. The
 * transparent trust SUMMARY rendering and listing-detail wiring land in #29,
 * which consumes the typed {@link ClaimAggregate} helper exported here.
 *
 * Server-only: imports the DB client and the auth guards. Never import from
 * client code. Each public server function is login-gated via
 * {@link requireCurrentUser} (throws 401 for anonymous callers).
 *
 * RATE-LIMIT SEAM (issue #18): these writes are user-driven mutations and must
 * be rate-limited, but the limiter from #18 is being built in parallel and is
 * NOT importable on this branch. The seam is marked at every write entry point
 * with a `RATE LIMIT (#18)` TODO. Once #18 lands, wrap each write once at that
 * seam — e.g. `await rateLimit(user.id, "attestation"); …` — rather than
 * threading a limiter through this module. Do not invent a limiter here.
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
 */
export async function getClaimAggregate(input: ClaimAggregateInput): Promise<ClaimAggregate> {
  const db = getDb();

  // One grouped scan: confirm/dispute counts for this claim's attestations.
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

  const claimRows = await db
    .select({ lastConfirmedAt: claims.lastConfirmedAt })
    .from(claims)
    .where(eq(claims.id, input.claimId))
    .limit(1);

  return {
    claimId: input.claimId,
    confirmCount,
    disputeCount,
    lastConfirmedAt: claimRows[0]?.lastConfirmedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Writes — upsert (confirm/dispute) and delete (retract), one vote per user
// ---------------------------------------------------------------------------

/**
 * Cast or change the current user's vote on a claim.
 *
 * Upserts against `attestations_claim_user_unique`: a first vote inserts; a
 * later vote by the same user on the same claim UPDATES the existing row's
 * `value` (and `updatedAt`) instead of inserting a duplicate — this is the
 * "one vote per user per claim, changeable" rule.
 *
 * A `confirm` also bumps the claim's `lastConfirmedAt` to now so the
 * recency-driven staleness signal stays current; `dispute` leaves it untouched.
 *
 * Login-gated: throws 401 for anonymous callers. RATE LIMIT (#18) seam — wrap
 * this entry point with the limiter once #18 lands (see module JSDoc).
 */
export async function castVote(input: VoteInput): Promise<void> {
  const user = await requireCurrentUser();
  // RATE LIMIT (#18): `await rateLimit(user.id, "attestation")` belongs here.

  const db = getDb();
  const now = new Date();

  await db
    .insert(attestations)
    .values({ claimId: input.claimId, userId: user.id, value: input.value })
    .onConflictDoUpdate({
      target: [attestations.claimId, attestations.userId],
      set: { value: input.value, updatedAt: now },
    });

  // A confirm refreshes the claim's recency signal; a dispute must not.
  if (input.value === "confirm") {
    await db
      .update(claims)
      .set({ lastConfirmedAt: now, updatedAt: now })
      .where(eq(claims.id, input.claimId));
  }
}

/**
 * Retract the current user's vote on a claim — deletes their `attestations`
 * row, leaving the claim's `lastConfirmedAt` as-is (an old confirmation is
 * still the last time the claim was affirmed). A no-op if no vote exists.
 *
 * Login-gated: throws 401 for anonymous callers. RATE LIMIT (#18) seam — wrap
 * this entry point with the limiter once #18 lands (see module JSDoc).
 */
export async function retractVote(input: RetractInput): Promise<void> {
  const user = await requireCurrentUser();
  // RATE LIMIT (#18): `await rateLimit(user.id, "attestation")` belongs here.

  await getDb()
    .delete(attestations)
    .where(and(eq(attestations.claimId, input.claimId), eq(attestations.userId, user.id)));
}

// ---------------------------------------------------------------------------
// Server-function wrappers — the entry points the listing-detail UI calls
// ---------------------------------------------------------------------------

/** Confirm/dispute server function (login-gated, validated). See {@link castVote}. */
export const submitVote = createServerFn({ method: "POST" })
  .validator(voteInputSchema)
  .handler(({ data }) => castVote(data));

/** Retract server function (login-gated, validated). See {@link retractVote}. */
export const removeVote = createServerFn({ method: "POST" })
  .validator(retractInputSchema)
  .handler(({ data }) => retractVote(data));

/** Read a claim's aggregate counts + recency. See {@link getClaimAggregate}. */
export const fetchClaimAggregate = createServerFn({ method: "GET" })
  .validator(claimAggregateInputSchema)
  .handler(({ data }) => getClaimAggregate(data));
