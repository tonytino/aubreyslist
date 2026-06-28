import { z } from "zod";
import { getDb } from "~/db/client";
import { flags } from "~/db/schema";
import { requireCurrentUser } from "~/server/auth/guards";
import { enforceWriteLimit } from "~/server/rate-limit";

/**
 * Content flagging — the WRITE layer for "report this as inappropriate / spam /
 * wrong" (issue #39, ADR-010 + domain.md "Roles & Permissions": flagging is a
 * plain authenticated-user power, not reputation-gated).
 *
 * Any signed-in user can flag exactly ONE target — a listing, a claim, or an
 * incident — with a free-text reason. The flag lands in the `flags` table with
 * `status: "open"` and feeds the moderation queue (moderator/admin surfaces,
 * separate issues).
 *
 * Exclusive-arc target: the `flags` table models the target as an exclusive arc
 * (`db/schema.ts` → `flags_one_target` CHECK: `num_nonnulls(listing_id,
 * claim_id, incident_id) = 1`). We mirror that invariant at the app layer with a
 * discriminated union so a flag with zero or multiple targets is rejected with a
 * clear validation error BEFORE it reaches the DB (rather than surfacing as an
 * opaque constraint-violation 500). The DB CHECK remains the ultimate guarantee.
 *
 * Server-only: imports the DB client and the auth guards. Never import this from
 * client code — the client-callable `createServerFn` wrappers live in
 * `./flags.fn.ts` (the `*.fn.ts` convention), so the browser bundle never drags
 * in `getDb` (neon/drizzle). See {@link createFlag}.
 *
 * Login-gated + rate-limited: every write runs {@link requireCurrentUser} (401
 * for anonymous callers) then {@link enforceWriteLimit} (429 on an abusive
 * burst, issue #18) before any DB work — mirroring the attestations/incidents
 * write path.
 */

// ---------------------------------------------------------------------------
// Input validation — exactly one target (exclusive arc), plus a reason
// ---------------------------------------------------------------------------

/** Max reason length — generous for context, bounded to blunt abuse / bloat. */
export const FLAG_REASON_MAX_LENGTH = 2000;

/** A non-empty, length-bounded report reason (trimmed before validation). */
const reasonSchema = z
  .string()
  .trim()
  .min(1, "A reason is required.")
  .max(FLAG_REASON_MAX_LENGTH, `Reason must be ${FLAG_REASON_MAX_LENGTH} characters or fewer.`);

/**
 * Exactly one target must be set. A discriminated union enforces the
 * exclusive-arc invariant structurally: each branch is `.strict()` and carries
 * exactly one target id, so a payload with zero targets fails to match any
 * branch and a payload with multiple target ids is rejected for the unknown
 * extra key — mirroring the DB `num_nonnulls(...) = 1` CHECK at the app layer.
 */
export const createFlagInputSchema = z.discriminatedUnion("target", [
  z
    .object({
      target: z.literal("listing"),
      listingId: z.string().min(1, "listingId is required"),
      reason: reasonSchema,
    })
    .strict(),
  z
    .object({
      target: z.literal("claim"),
      claimId: z.string().min(1, "claimId is required"),
      reason: reasonSchema,
    })
    .strict(),
  z
    .object({
      target: z.literal("incident"),
      incidentId: z.string().min(1, "incidentId is required"),
      reason: reasonSchema,
    })
    .strict(),
]);
export type CreateFlagInput = z.infer<typeof createFlagInputSchema>;

// ---------------------------------------------------------------------------
// Write — insert an open flag attributed to the reporting user
// ---------------------------------------------------------------------------

/**
 * Create a content flag on a listing, claim, or incident.
 *
 * Inserts a single `flags` row with the resolved target column set (the other
 * two left null per the exclusive arc), `reporterId` = the authenticated user,
 * `reason` = the trimmed report, and `status: "open"` so it enters the
 * moderation queue.
 *
 * Login-gated: throws 401 for anonymous callers, then rate-limited per user via
 * {@link enforceWriteLimit} (issue #18; throws 429 on an abusive burst) before
 * any DB work.
 */
export async function createFlag(input: CreateFlagInput): Promise<void> {
  const user = await requireCurrentUser();
  await enforceWriteLimit(user.id);

  const db = getDb();

  // Resolve the single target column from the discriminated input. Exactly one
  // is set; the other two stay undefined (null in the row) per the exclusive arc.
  const target =
    input.target === "listing"
      ? { listingId: input.listingId }
      : input.target === "claim"
        ? { claimId: input.claimId }
        : { incidentId: input.incidentId };

  await db.insert(flags).values({
    ...target,
    reporterId: user.id,
    reason: input.reason,
    status: "open",
  });
}

// The client-callable `createServerFn` wrapper (submitFlag) lives in
// `./flags.fn.ts` (the `*.fn.ts` convention), so client code never imports this
// db-touching module — see the module docstring above.
