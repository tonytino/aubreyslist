import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getDb } from "~/db/client";
import { type Incident, incidents, listings } from "~/db/schema";
import { requireCurrentUser } from "~/server/auth/guards";
import { enforceWriteLimit } from "~/server/rate-limit";
import {
  type EditIncidentInput,
  type ListIncidentsInput,
  type ReportIncidentInput,
  type RetractIncidentInput,
  toCalendarDayString,
} from "~/trust/incident-recency";

/**
 * "Got glutened here" incident reports — the db-touching read + write
 * implementations (ADR-007 trust model).
 *
 * A signed-in user reports an incident on a listing: a required `occurredOn`
 * date with optional `severity` and free-text `note` (domain.md, "Incident").
 * Incidents are listed most-recent-first, and a recent incident visibly flags
 * the listing's trust summary regardless of how many older confirmations
 * exist — fresh harm is never buried (ADR-007, domain.md → Trust Model).
 *
 * Server-only: imports the DB client and the auth guards. Never import this
 * module from client code — it transitively pulls in `getDb` (neon/drizzle).
 * Client-callable server functions live in `./incidents.fn.ts` (the `*.fn.ts`
 * convention); pure, client-safe helpers live in
 * `app/trust/incident-recency.ts`. Client components import only those two.
 *
 * Writes are login-gated via {@link requireCurrentUser} (throws 401) and then
 * rate-limited per user via {@link enforceWriteLimit} (throws 429) before any
 * DB work. Reads ({@link listIncidents}) are open and unmetered.
 *
 * Users may also edit and retract their own incidents (domain.md, "Edit /
 * retract own contributions"). {@link editIncident} and
 * {@link retractIncident} additionally enforce ownership server-side: the
 * mutation only matches a row whose `userId` equals the current user, so a
 * non-owner (or anonymous) caller can never edit or delete someone else's
 * report — enforced in the DB predicate, not just hidden in the UI.
 */

/**
 * Normalize a freshly-read incident row's `occurredOn` to the canonical
 * `YYYY-MM-DD` calendar-date string the app contracts on.
 *
 * `incidents.occurred_on` is a Postgres `date` (Drizzle `PgDateString`, which
 * passes the driver value through verbatim), and the Neon HTTP driver returns
 * a `date` as a JS `Date`, not the `YYYY-MM-DD` text — but the recency logic
 * and date formatting require the string. Normalizing once at the read
 * boundary gives every consumer the contract regardless of the driver. See
 * `toCalendarDayString`. The column type already declares
 * `occurredOn: string`; this fixes the runtime value to match.
 */
function normalizeIncident(row: Incident): Incident {
  return { ...row, occurredOn: toCalendarDayString(row.occurredOn) };
}

// ---------------------------------------------------------------------------
// Read — a listing's incidents, most-recent first
// ---------------------------------------------------------------------------

/**
 * List a listing's incidents ordered most-recent-first by `occurredOn` (ties
 * broken by `createdAt` so same-day ordering is deterministic). Open and
 * unmetered — reads stay anonymous (domain.md, "Read is open").
 *
 * Visibility-aware: this is a public read, so a hidden/removed incident
 * (`moderationStatus != 'visible'`) is excluded from both the incident list
 * and the recent-incident banner (derived from this same list). This serves
 * the trust principle "recent harm is never buried" (domain.md → Trust
 * Model): a real, still-visible recent incident always stays — only an
 * incident a moderator has hidden/removed drops out.
 *
 * Parent visibility: `moderationStatus` has no parent→child propagation, so a
 * moderator hiding/removing the listing leaves its incidents `visible`. To
 * stop a moderated-away listing leaking its incidents via this addressable
 * per-listing RPC, the query inner-joins `listings` and additionally requires
 * the parent listing to be `visible` — both the incident and its listing must
 * survive moderation.
 */
export async function listIncidents(input: ListIncidentsInput): Promise<Incident[]> {
  const rows = await getDb()
    // Project only the incident columns: the join to `listings` is a visibility
    // gate, not data we return, so the row shape stays a flat `Incident`.
    .select(getTableColumns(incidents))
    .from(incidents)
    .innerJoin(listings, eq(listings.id, incidents.listingId))
    .where(
      and(
        eq(incidents.listingId, input.listingId),
        eq(incidents.moderationStatus, "visible"),
        eq(listings.moderationStatus, "visible")
      )
    )
    .orderBy(desc(incidents.occurredOn), desc(incidents.createdAt));
  // Normalize each row's `occurredOn` to the canonical YYYY-MM-DD string the
  // recency banner + date formatting depend on (the driver returns a Date).
  return rows.map(normalizeIncident);
}

// ---------------------------------------------------------------------------
// Write — report an incident (login-gated, rate-limited)
// ---------------------------------------------------------------------------

/**
 * Record a "got glutened here" incident for the current user on a listing.
 *
 * Login-gated: throws 401 for anonymous callers, then rate-limited per user
 * via {@link enforceWriteLimit} (throws 429) before any DB work. Returns the
 * inserted row so the UI can optimistically render it.
 */
export async function reportIncident(input: ReportIncidentInput): Promise<Incident> {
  const user = await requireCurrentUser();
  await enforceWriteLimit(user.id);

  const inserted = await getDb()
    .insert(incidents)
    .values({
      listingId: input.listingId,
      userId: user.id,
      occurredOn: input.occurredOn,
      severity: input.severity ?? null,
      note: input.note ?? null,
    })
    .returning();

  // A single-row insert always returns exactly one row; narrow off `undefined`.
  const row = inserted[0];
  if (!row) {
    throw new Error("Incident insert returned no row.");
  }
  return normalizeIncident(row);
}

// ---------------------------------------------------------------------------
// Edit — update an own incident (login-gated, rate-limited, ownership-checked)
// ---------------------------------------------------------------------------

/**
 * Edit the current user's own incident — `occurredOn` / `severity` / `note`.
 *
 * Login-gated then rate-limited (like {@link reportIncident}). Ownership is
 * enforced server-side: the UPDATE matches on both the incident `id` and
 * `userId = current user`, so a non-owner's edit affects zero rows and throws
 * `403`. `updatedAt` is bumped to now. Editing `occurredOn` in/out of the
 * recency window flows through {@link findRecentIncident} on the next read,
 * so the recent-incident banner recomputes correctly after the change.
 *
 * @throws {HTTPException} `401` anonymous, `429` over the rate limit, `403`/`404`
 *   when the row does not exist or is not owned by the current user.
 */
export async function editIncident(input: EditIncidentInput): Promise<Incident> {
  const user = await requireCurrentUser();
  await enforceWriteLimit(user.id);

  const updated = await getDb()
    .update(incidents)
    .set({
      occurredOn: input.occurredOn,
      severity: input.severity ?? null,
      note: input.note ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(incidents.id, input.id), eq(incidents.userId, user.id)))
    .returning();

  // Zero rows ⇒ the incident does not exist or is not owned by this user.
  // Either way the caller may not edit it; reject rather than silently no-op
  // so the UI surfaces the failure (ownership is enforced here, not in the UI).
  const row = updated[0];
  if (!row) {
    throw new HTTPException(403, {
      message: "You can only edit your own incident reports.",
    });
  }
  return normalizeIncident(row);
}

// ---------------------------------------------------------------------------
// Retract — delete an own incident (login-gated, rate-limited, ownership-checked)
// ---------------------------------------------------------------------------

/**
 * Retract (delete) the current user's own incident.
 *
 * Login-gated then rate-limited (like {@link reportIncident}). Ownership is
 * enforced server-side: the DELETE matches on both the incident `id` and
 * `userId = current user`, so a non-owner's request deletes zero rows and
 * throws `403`. Deleting a recent incident drops it from the next read, so
 * the recent-incident banner and aggregates recompute correctly.
 *
 * @throws {HTTPException} `401` anonymous, `429` over the rate limit, `403`/`404`
 *   when the row does not exist or is not owned by the current user.
 */
export async function retractIncident(input: RetractIncidentInput): Promise<void> {
  const user = await requireCurrentUser();
  await enforceWriteLimit(user.id);

  const deleted = await getDb()
    .delete(incidents)
    .where(and(eq(incidents.id, input.id), eq(incidents.userId, user.id)))
    .returning({ id: incidents.id });

  if (deleted.length === 0) {
    throw new HTTPException(403, {
      message: "You can only retract your own incident reports.",
    });
  }
}
