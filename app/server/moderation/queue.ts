import { desc, eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { type ClaimAttribute, claims, flags, incidents, listings, users } from "~/db/schema";
import { requireCurrentRole } from "~/server/auth/guards";
import { claimAttributeLabel } from "~/trust/summary";
import type { ModerationQueue, QueueItem, QueueTargetType } from "./queue.fn";

/**
 * Server-only moderation-queue query behind the `fetchModerationQueue` server fn
 * (issue #40, ADR-010 + domain.md "Roles & Permissions").
 *
 * Moderators and admins triage flagged content here, so this is an ADR-010
 * security boundary enforced SERVER-SIDE, never trusted to the UI. Like the
 * admin-panel gate it reports a typed `access` discriminator rather than letting
 * the raw 401/403 escape, so the route loader can map the verdict to the right
 * UX:
 *
 * - `anonymous` → redirect to sign-in,
 * - `forbidden` (a plain `user`) → render the not-authorised UI,
 * - `granted` → render the queue.
 *
 * Unlike a plain `requireCurrentRole("moderator")` write guard (which simply
 * throws), the loader needs to distinguish anon-vs-forbidden to render two
 * different surfaces; we still run the SAME guard so the real 401/403 policy
 * decides access (admins out-rank moderators and pass; plain users get 403;
 * anonymous callers get 401), and only translate those into the discriminator.
 *
 * The queue lists OPEN flags only — resolved/dismissed/in-review flags have left
 * the triage surface. Each flag's single target (the exclusive arc: exactly one
 * of listing/claim/incident, enforced by the `flags_one_target` CHECK) is
 * resolved to a human label/snippet via LEFT JOINs, and the reporter's name/
 * email is joined from `users`. Newest first, so the freshest reports surface.
 *
 * Server-only: imports the DB client and the auth guards (and `getCurrentUser`
 * transitively). Never import from client code — the client-callable
 * `createServerFn` wrapper lives in `./queue.fn.ts` (the `*.fn.ts` convention),
 * so the browser bundle never drags in `getDb` (neon/drizzle).
 */

/**
 * Resolve the moderation queue with a server-side access verdict.
 *
 * Runs `requireCurrentRole("moderator")` first (admins pass too). On success the
 * caller is a moderator/admin and we load the open flags; the guard's thrown
 * `HTTPException` (401 anon / 403 plain user) is caught and mapped to the typed
 * discriminator the loader renders from.
 */
export async function resolveModerationQueue(): Promise<ModerationQueue> {
  try {
    await requireCurrentRole("moderator");
  } catch (error) {
    // The guard throws 401 for anonymous callers and 403 for under-privileged
    // ones; map those to the loader's two non-granted UX outcomes. Anything
    // else is unexpected and should propagate.
    const status = (error as { status?: number }).status;
    if (status === 401) {
      return { access: "anonymous" };
    }
    if (status === 403) {
      return { access: "forbidden" };
    }
    throw error;
  }

  const items = await listOpenFlags();
  return { access: "granted", items };
}

/**
 * Load every OPEN flag with the context a moderator needs to triage it: the
 * target (type + id + a human label/snippet), the reason, the reporter, and the
 * created date. Newest first.
 *
 * One query: filter `flags` to `status = "open"`, INNER JOIN the reporter (a
 * flag always has a `reporterId`), and LEFT JOIN each possible target table (the
 * exclusive arc means exactly one of the three joins matches per row). The
 * target type is derived from which target column is non-null; the label/snippet
 * is composed from the matched row.
 */
async function listOpenFlags(): Promise<QueueItem[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: flags.id,
      reason: flags.reason,
      createdAt: flags.createdAt,
      listingId: flags.listingId,
      claimId: flags.claimId,
      incidentId: flags.incidentId,
      reporterName: users.name,
      reporterEmail: users.email,
      // Target context (only one set per row, per the exclusive arc).
      flaggedListingName: listings.name,
      flaggedClaimAttribute: claims.attribute,
      claimListingId: claims.listingId,
      incidentNote: incidents.note,
      incidentListingId: incidents.listingId,
    })
    .from(flags)
    .innerJoin(users, eq(users.id, flags.reporterId))
    .leftJoin(listings, eq(listings.id, flags.listingId))
    .leftJoin(claims, eq(claims.id, flags.claimId))
    .leftJoin(incidents, eq(incidents.id, flags.incidentId))
    .where(eq(flags.status, "open"))
    .orderBy(desc(flags.createdAt));

  return rows.map((row): QueueItem => {
    const target = resolveTarget(row);
    return {
      id: row.id,
      reason: row.reason,
      createdAt: row.createdAt,
      reporter: { name: row.reporterName, email: row.reporterEmail },
      target,
    };
  });
}

/** The columns `resolveTarget` needs off a joined queue row. */
interface TargetRow {
  listingId: string | null;
  claimId: string | null;
  incidentId: string | null;
  flaggedListingName: string | null;
  flaggedClaimAttribute: ClaimAttribute | null;
  claimListingId: string | null;
  incidentNote: string | null;
  incidentListingId: string | null;
}

/**
 * Derive the flag's target (type + id + human label) from the joined row.
 *
 * Exactly one of the three target ids is set (the exclusive arc), so we pick the
 * matching branch and compose a label/snippet from that target's joined columns.
 * The fallbacks ("Listing", "Incident report", a placeholder snippet) keep the
 * label honest if the joined content row is somehow missing.
 */
function resolveTarget(row: TargetRow): QueueItem["target"] {
  if (row.listingId !== null) {
    return {
      type: "listing",
      id: row.listingId,
      label: row.flaggedListingName ?? "Listing",
      listingId: row.listingId,
    };
  }

  if (row.claimId !== null) {
    const attribute = row.flaggedClaimAttribute;
    return {
      type: "claim",
      id: row.claimId,
      label: attribute ? claimAttributeLabel(attribute) : "Claim",
      listingId: row.claimListingId,
    };
  }

  // Per the exclusive arc, if neither listing nor claim is set the incident is.
  const note = row.incidentNote?.trim();
  return {
    type: "incident",
    id: row.incidentId ?? "",
    label: note && note.length > 0 ? truncate(note, 80) : "Incident report",
    listingId: row.incidentListingId,
  };
}

/** Trim a snippet to `max` characters, appending an ellipsis when shortened. */
function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

// Re-export the target type so callers needing only the type don't import from
// two modules; the canonical declaration lives in `./queue.fn` (client-safe).
export type { ModerationQueue, QueueItem, QueueTargetType };
