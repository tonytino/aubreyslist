import { createServerFn } from "@tanstack/react-start";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import { type Incident, incidentSeverities, incidents } from "~/db/schema";
import { requireCurrentUser } from "~/server/auth/guards";
import { enforceWriteLimit } from "~/server/rate-limit";

/**
 * "Got glutened here" incident reports — the WRITE + recency-signal layer
 * (issue #30, ADR-007 trust model).
 *
 * A signed-in user reports an incident on a listing: a required `occurredOn`
 * date with an optional `severity` (mild/moderate/severe) and free-text `note`
 * (domain.md, "Incident"). Incidents are listed most-recent-first, and a RECENT
 * incident visibly flags the listing's trust summary **regardless of** how many
 * older confirmations exist — fresh harm is never buried (ADR-007,
 * domain.md → Trust Model: "Recent incidents flag the summary").
 *
 * Server-only: imports the DB client and the auth guards. Never import from
 * client code. The write entry point is login-gated via {@link requireCurrentUser}
 * (throws 401 for anonymous callers) and then rate-limited per user via
 * {@link enforceWriteLimit} (issue #18; throws 429 on an abusive burst) before
 * any DB work. Reads ({@link listIncidents}) are open and unmetered.
 */

// ---------------------------------------------------------------------------
// Recency window — when does an incident still "flag" the summary?
// ---------------------------------------------------------------------------

/**
 * How recent a "got glutened" incident must be to raise the prominent warning
 * banner on a listing. Chosen at **90 days**: long enough that a real, fairly
 * recent reaction still warns the next diner, short enough that a months-old
 * one-off doesn't permanently brand a restaurant that may have since fixed its
 * process.
 *
 * NOTE: this is the *incident-recency* window. It is deliberately SEPARATE from
 * the 6-month claim-staleness window (an admin-tunable AppSetting handled by
 * issue #31) — the two answer different questions ("is this harm still fresh?"
 * vs. "is this confirmation still current?") and must not be coupled.
 */
export const RECENT_INCIDENT_WINDOW_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * A reported incident. `occurredOn` is required and stored as a calendar date
 * (`YYYY-MM-DD`, matching the `date` column); severity/note are optional. An
 * empty note string is normalised to `undefined` so we never persist a blank.
 */
export const reportIncidentInputSchema = z.object({
  listingId: z.string().min(1, "listingId is required"),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "occurredOn must be a YYYY-MM-DD date"),
  severity: z.enum(incidentSeverities).optional(),
  note: z
    .string()
    .trim()
    .max(2000, "note is too long")
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type ReportIncidentInput = z.infer<typeof reportIncidentInputSchema>;

/** Listing a listing's incidents needs only the listing id. */
export const listIncidentsInputSchema = z.object({
  listingId: z.string().min(1, "listingId is required"),
});
export type ListIncidentsInput = z.infer<typeof listIncidentsInputSchema>;

// ---------------------------------------------------------------------------
// Recency helper — reusable across the listing banner and (later) list cards
// ---------------------------------------------------------------------------

/**
 * Whether `occurredOn` falls within the {@link RECENT_INCIDENT_WINDOW_DAYS}
 * window ending at `now`. Pure and side-effect-free so both the listing-detail
 * banner and the browse-list card signal (issue #33, not built yet) can share
 * one definition of "recent".
 *
 * Boundary rule: an incident exactly `RECENT_INCIDENT_WINDOW_DAYS` old still
 * counts as recent (inclusive); strictly older does not. Future-dated incidents
 * are treated as recent (they are by definition not stale).
 *
 * Comparison is on **calendar-day** granularity: incidents are stored as dates
 * (no time-of-day), so both `occurredOn` and `now` are floored to their UTC
 * midnight before measuring the gap. This keeps the window a clean "N days" and
 * makes the boundary independent of the time of day the check runs.
 *
 * @param occurredOn The incident's calendar date (`YYYY-MM-DD`) or a `Date`.
 * @param now The reference instant; defaults to now (injectable for tests).
 */
export function isRecentIncident(occurredOn: string | Date, now: Date = new Date()): boolean {
  const occurred = occurredOn instanceof Date ? occurredOn : new Date(`${occurredOn}T00:00:00Z`);
  if (Number.isNaN(occurred.getTime())) {
    return false;
  }
  const occurredDay = utcMidnight(occurred);
  const nowDay = utcMidnight(now);
  const ageMs = nowDay - occurredDay;
  // Future-dated -> recent; otherwise within the inclusive window.
  return ageMs <= RECENT_INCIDENT_WINDOW_DAYS * MS_PER_DAY;
}

/** Floor a `Date` to its UTC-midnight epoch ms (calendar-day granularity). */
function utcMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Given a listing's incidents, return the single most recent one if it falls
 * inside the recency window, else `null`. The summary banner renders when this
 * is non-null. Operates on whatever ordering it is handed but does not assume
 * one — it scans for the max `occurredOn` itself so callers can pass an
 * unsorted list safely.
 */
export function findRecentIncident<T extends { occurredOn: string }>(
  incidentList: readonly T[],
  now: Date = new Date()
): T | null {
  let mostRecent: T | null = null;
  for (const incident of incidentList) {
    if (!isRecentIncident(incident.occurredOn, now)) {
      continue;
    }
    if (mostRecent === null || incident.occurredOn > mostRecent.occurredOn) {
      mostRecent = incident;
    }
  }
  return mostRecent;
}

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

// ---------------------------------------------------------------------------
// Server-function wrappers — the entry points the listing-detail UI calls
// ---------------------------------------------------------------------------

/** Report-incident server function (login-gated, validated). See {@link reportIncident}. */
export const submitIncident = createServerFn({ method: "POST" })
  .validator(reportIncidentInputSchema)
  .handler(({ data }) => reportIncident(data));

/** Read a listing's incidents, most-recent first. See {@link listIncidents}. */
export const fetchIncidents = createServerFn({ method: "GET" })
  .validator(listIncidentsInputSchema)
  .handler(({ data }) => listIncidents(data));
