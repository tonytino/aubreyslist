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
 * "Got glutened here" incident reports — the db-touching READ + WRITE
 * implementations (issue #30, ADR-007 trust model).
 *
 * A signed-in user reports an incident on a listing: a required `occurredOn`
 * date with an optional `severity` (mild/moderate/severe) and free-text `note`
 * (domain.md, "Incident"). Incidents are listed most-recent-first, and a RECENT
 * incident visibly flags the listing's trust summary **regardless of** how many
 * older confirmations exist — fresh harm is never buried (ADR-007,
 * domain.md → Trust Model: "Recent incidents flag the summary").
 *
 * Server-only: imports the DB client and the auth guards. NEVER import this
 * module from client code — it transitively pulls in `getDb` (neon/drizzle).
 * The split that keeps the client build clean:
 *
 * - **Client-callable server functions** ({@link submitIncident},
 *   {@link fetchIncidents}) live in `./incidents.fn.ts` (the `*.fn.ts`
 *   convention, like `current-user.fn.ts`); the plugin strips their handler
 *   bodies out of the browser bundle.
 * - **Pure, client-safe helpers** (recency window constant, calendar-date
 *   parsing, Zod schemas, `isRecentIncident` / `findRecentIncident`) live in
 *   `app/trust/incident-recency.ts`.
 *
 * Client components import only those two; this db module stays server-only.
 *
 * The write is login-gated via {@link requireCurrentUser} (throws 401 for
 * anonymous callers) and then rate-limited per user via {@link enforceWriteLimit}
 * (issue #18; throws 429 on an abusive burst) before any DB work. Reads
 * ({@link listIncidents}) are open and unmetered.
 *
 * Users may also EDIT and RETRACT their OWN incidents (issue #32, domain.md
 * "Edit / retract own contributions"). {@link editIncident} and
 * {@link retractIncident} are login-gated + rate-limited like the report path,
 * and additionally enforce OWNERSHIP server-side: the mutation only matches a
 * row whose `userId` equals the current user, so a non-owner (or anonymous)
 * caller can never edit or delete someone else's report — this is enforced in
 * the DB predicate, not just hidden in the UI. Moderators removing ANY content
 * is a separate concern (EPIC 6), out of scope here.
 */

/**
 * Normalize a freshly-read incident row's `occurredOn` to the canonical
 * `YYYY-MM-DD` calendar-date string the app contracts on.
 *
 * `incidents.occurred_on` is a Postgres `date` (Drizzle `PgDateString`, which
 * passes the driver value through verbatim). The Neon HTTP driver's `pg-types`
 * parser returns a `date` as a JS `Date`, NOT the `YYYY-MM-DD` text — and the
 * recency logic (`parseCalendarDay` → the recent-incident banner) + the date
 * formatting both require the string. We normalize once here, at the read
 * boundary, so every consumer (server + client) gets the contract regardless of
 * the driver. See `toCalendarDayString` and issue #45. The column type already
 * declares `occurredOn: string`, so this only fixes the runtime value to match.
 */
function normalizeIncident(row: Incident): Incident {
  return { ...row, occurredOn: toCalendarDayString(row.occurredOn) };
}

// ---------------------------------------------------------------------------
// Read — a listing's incidents, most-recent first
// ---------------------------------------------------------------------------

/**
 * List a listing's incidents ordered most-recent-first by `occurredOn` (ties
 * broken by `createdAt` so the same-day ordering is stable and deterministic).
 * Open and unmetered — reads stay anonymous (domain.md, "Read is open").
 *
 * Visibility-aware (#41): this is a PUBLIC read, so a hidden/removed incident
 * (`moderationStatus != 'visible'`) is excluded from BOTH the incident list and
 * the recent-incident banner (which is derived from this same list on the detail
 * page). This directly serves the trust principle "recent harm is never buried"
 * (domain.md → Trust Model): a real, still-visible recent incident always stays
 * — only an incident a moderator has hidden/removed drops out.
 *
 * Parent visibility: `moderationStatus` has no parent→child propagation, so a
 * moderator hiding/removing the LISTING leaves its incidents `visible`. To stop a
 * moderated-away listing leaking its incidents via this addressable per-listing
 * RPC, we INNER JOIN `listings` and additionally require the parent listing to be
 * `visible` — both the incident AND its listing must survive moderation.
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
 * Login-gated: throws 401 for anonymous callers, then rate-limited per user via
 * {@link enforceWriteLimit} (issue #18; throws 429 on an abusive burst) before
 * any DB work. Returns the inserted row so the UI can optimistically render it.
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
// Edit — update an OWN incident (login-gated, rate-limited, ownership-checked)
// ---------------------------------------------------------------------------

/**
 * Edit the current user's own incident — `occurredOn` / `severity` / `note`.
 *
 * Login-gated then rate-limited (like {@link reportIncident}). Ownership is
 * enforced SERVER-SIDE: the UPDATE matches on BOTH the incident `id` AND
 * `userId = current user`, so a non-owner's edit affects zero rows and we throw
 * `403`. `updatedAt` is bumped to now. Editing `occurredOn` in/out of the
 * recency window naturally flows through {@link findRecentIncident} on the next
 * read, so the recent-incident banner recomputes correctly after the change.
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

  // Zero rows ⇒ the incident does not exist OR is not owned by this user. Either
  // way the caller may not edit it; reject rather than silently no-op so the UI
  // surfaces the failure (ownership is enforced here, not just in the UI).
  const row = updated[0];
  if (!row) {
    throw new HTTPException(403, {
      message: "You can only edit your own incident reports.",
    });
  }
  return normalizeIncident(row);
}

// ---------------------------------------------------------------------------
// Retract — delete an OWN incident (login-gated, rate-limited, ownership-checked)
// ---------------------------------------------------------------------------

/**
 * Retract (delete) the current user's own incident.
 *
 * Login-gated then rate-limited (like {@link reportIncident}). Ownership is
 * enforced SERVER-SIDE: the DELETE matches on BOTH the incident `id` AND
 * `userId = current user`, so a non-owner's request deletes zero rows and we
 * throw `403`. Deleting a recent incident drops it from the next read, so the
 * recent-incident banner and aggregates recompute correctly after the change.
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
