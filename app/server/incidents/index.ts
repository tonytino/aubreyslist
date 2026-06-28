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
// Calendar-date parsing — the single source of truth for incident dates
// ---------------------------------------------------------------------------

/**
 * Parse a `YYYY-MM-DD` string to its UTC-midnight epoch ms, or `null` if it is
 * not a *real* calendar date. A bare format check is not enough: `2026-02-31`,
 * `2026-13-45`, and `2026-00-00` all match `\d{4}-\d{2}-\d{2}` but are not
 * dates. We round-trip through `Date.UTC` and require the components to survive
 * unchanged, which rejects month/day overflow that JS would otherwise roll
 * forward (e.g. Feb 31 -> Mar 3).
 */
function parseCalendarDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const round = new Date(ms);
  // Reject overflow: a valid date round-trips to the same components.
  if (
    round.getUTCFullYear() !== year ||
    round.getUTCMonth() !== month - 1 ||
    round.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

/** Today's date floored to UTC midnight (epoch ms) — the "no future" ceiling. */
function todayUtcMidnight(now: Date = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * A reported incident. `occurredOn` is required and stored as a calendar date
 * (`YYYY-MM-DD`, matching the `date` column); severity/note are optional. An
 * empty note string is normalised to `undefined` so we never persist a blank.
 *
 * `occurredOn` is validated as a *real* calendar date (rejecting `2026-02-31`
 * et al. before they reach the Postgres `date` column) AND constrained to not be
 * in the future — a "got glutened" report describes something that has already
 * happened. The no-future rule is enforced server-side here (through
 * `submitIncident`), not just in the UI, so a future date can never pin the
 * recent-incident banner forever.
 */
export const reportIncidentInputSchema = z.object({
  listingId: z.string().min(1, "listingId is required"),
  occurredOn: z
    .string()
    .refine((value) => parseCalendarDay(value) !== null, {
      message: "occurredOn must be a real YYYY-MM-DD date",
    })
    .refine(
      (value) => {
        const day = parseCalendarDay(value);
        return day !== null && day <= todayUtcMidnight();
      },
      { message: "occurredOn cannot be in the future" }
    ),
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
 * counts as recent (inclusive); strictly older does not. A future-dated incident
 * is NOT recent — the report schema already rejects future dates, but this is
 * defense in depth so a bad row can never pin the banner forever.
 *
 * Recency is **UTC-calendar-based**: incidents are stored as dates (no
 * time-of-day), so both `occurredOn` and `now` are floored to their UTC midnight
 * before measuring the gap. This keeps the window a clean "N days", makes the
 * boundary independent of the time of day the check runs, and matches the basis
 * `relativeIncidentDate` uses, so server (SSR) and client agree.
 *
 * @param occurredOn The incident's calendar date (`YYYY-MM-DD`) or a `Date`.
 * @param now The reference instant; defaults to now (injectable for tests).
 */
export function isRecentIncident(occurredOn: string | Date, now: Date = new Date()): boolean {
  const occurredDay =
    occurredOn instanceof Date
      ? Date.UTC(occurredOn.getUTCFullYear(), occurredOn.getUTCMonth(), occurredOn.getUTCDate())
      : parseCalendarDay(occurredOn);
  if (occurredDay === null || Number.isNaN(occurredDay)) {
    return false;
  }
  const nowDay = todayUtcMidnight(now);
  const ageMs = nowDay - occurredDay;
  // Future-dated (ageMs < 0) is not recent; otherwise within the inclusive window.
  return ageMs >= 0 && ageMs <= RECENT_INCIDENT_WINDOW_DAYS * MS_PER_DAY;
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
