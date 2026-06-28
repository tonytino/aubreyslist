import { desc, eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { type Incident, incidents } from "~/db/schema";
import { requireCurrentUser } from "~/server/auth/guards";
import { enforceWriteLimit } from "~/server/rate-limit";
import type { ListIncidentsInput, ReportIncidentInput } from "~/trust/incident-recency";

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
 */

// ---------------------------------------------------------------------------
// Read — a listing's incidents, most-recent first
// ---------------------------------------------------------------------------

/**
 * List a listing's incidents ordered most-recent-first by `occurredOn` (ties
 * broken by `createdAt` so the same-day ordering is stable and deterministic).
 * Open and unmetered — reads stay anonymous (domain.md, "Read is open").
 */
export async function listIncidents(input: ListIncidentsInput): Promise<Incident[]> {
  return getDb()
    .select()
    .from(incidents)
    .where(eq(incidents.listingId, input.listingId))
    .orderBy(desc(incidents.occurredOn), desc(incidents.createdAt));
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
  return row;
}
