import { z } from "zod";
import type { incidentSeverities as DbIncidentSeverities } from "~/db/schema";

/**
 * Pure incident recency + validation helpers (ADR-007).
 *
 * Client-safe: imports no runtime value from the DB layer — only `zod` and a
 * type-only reference to the schema enum (erased at build). Importing the
 * runtime `incidentSeverities` tuple from `~/db/schema` would drag
 * `drizzle-orm/pg-core` (and server-only stream code) into the browser bundle
 * and break the client build, so a plain literal mirror is declared here with
 * a type-level lockstep assertion. Never move `getDb` (or a schema value
 * import) into this file.
 */

/**
 * Client-safe mirror of the `incident_severity` DB enum (`db/schema.ts`). Kept
 * as a plain literal so this module pulls in no schema runtime; the type-level
 * checks below fail the build if it ever drifts from `incidentSeverities`.
 */
export const INCIDENT_SEVERITIES = ["mild", "moderate", "severe"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

// Compile-time guard: the literal mirror and the DB enum must be identical sets.
type _AssertSeveritiesMatch = [
  (typeof DbIncidentSeverities)[number] extends IncidentSeverity ? true : never,
  IncidentSeverity extends (typeof DbIncidentSeverities)[number] ? true : never,
];
// Exported so the compile-time drift guard `_AssertSeveritiesMatch` is not
// itself flagged unused; the export has no importer by design — it exists purely
// to fail typecheck if the client-safe literal drifts from the DB enum.
/** @knippublic intentional compile-time drift guard, no runtime importer */
export type IncidentSeveritiesInSyncWithDb = _AssertSeveritiesMatch;

// ---------------------------------------------------------------------------
// Recency window — when does an incident still "flag" the summary?
// ---------------------------------------------------------------------------

/**
 * How recent a "got glutened" incident must be to raise the warning banner on
 * a listing. 90 days: long enough that a recent reaction still warns the next
 * diner, short enough that a months-old one-off doesn't permanently brand a
 * restaurant.
 *
 * This is the incident-recency window, deliberately separate from the
 * claim-staleness window (an admin-tunable AppSetting) — the two answer
 * different questions ("is this harm still fresh?" vs. "is this confirmation
 * still current?") and must not be coupled.
 */
export const RECENT_INCIDENT_WINDOW_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Calendar-date parsing — the single source of truth for incident dates
// ---------------------------------------------------------------------------

/**
 * Parse a `YYYY-MM-DD` string to its UTC-midnight epoch ms, or `null` if it is
 * not a real calendar date. A bare format check is not enough (`2026-02-31`
 * matches the pattern but is not a date): the round-trip through `Date.UTC`
 * requires the components to survive unchanged, rejecting month/day overflow
 * that JS would otherwise roll forward (e.g. Feb 31 -> Mar 3).
 */
export function parseCalendarDay(value: string): number | null {
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

/**
 * Normalize whatever the DB driver hands back for a `date` column into the
 * canonical `YYYY-MM-DD` calendar-date string the rest of the app contracts on.
 *
 * Driver quirk: `incidents.occurred_on` is a Postgres `date` (Drizzle
 * `PgDateString`, which passes the driver value through verbatim), and the
 * Neon HTTP driver's `pg-types` parser returns the `date` OID as a JS `Date`,
 * not the `YYYY-MM-DD` text. Downstream consumers assume a clean string; a
 * raw `Date` silently breaks the recent-incident banner and date formatting.
 * Normalizing once at the read boundary keeps the calendar-date contract.
 *
 * TZ correctness: `pg-types` builds the `Date` for a bare `date` (OID 1082)
 * at local midnight of the runtime TZ (`new Date(y, m-1, d)`), not UTC
 * midnight. Recovering the stored calendar day therefore requires the local
 * getters (`getFullYear`/`getMonth`/`getDate`) — the same basis the driver
 * wrote it. UTC getters are off-by-one on a positive-offset runtime (e.g.
 * `Asia/Tokyo`: stored `2026-06-28` reads back as `2026-06-27`); local
 * getters return the stored day in any runtime TZ.
 *
 * Accepts the already-correct `YYYY-MM-DD` string (returned unchanged) or a
 * `Date` (the driver's local-midnight value) and returns its `YYYY-MM-DD`
 * calendar day. A value with no resolvable calendar day is coerced to a string
 * unchanged, so a malformed value still surfaces downstream rather than being
 * masked as a fabricated date.
 */
export function toCalendarDayString(value: string | Date): string {
  // Fast path: already the canonical contract.
  if (typeof value === "string" && parseCalendarDay(value) !== null) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  // Local getters: the driver built this Date at local midnight (see above),
  // so reading it on the same basis recovers the stored calendar day in any
  // runtime TZ. Never switch these to the UTC getters — that reintroduces the
  // positive-offset off-by-one.
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today's date floored to UTC midnight (epoch ms) — the "no future" ceiling. */
export function todayUtcMidnight(now: Date = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

// ---------------------------------------------------------------------------
// Input validation (pure schema — reused by the server fn's validator)
// ---------------------------------------------------------------------------

/**
 * The `occurredOn` calendar date shared by the report and edit schemas: a
 * real calendar date (rejecting `2026-02-31` et al. before they reach the
 * Postgres `date` column) that is not in the future. Declared once so an edit
 * can never sneak a future or impossible date past the report path.
 *
 * One `superRefine`, not chained `.refine()`s: every chained refine runs, so an
 * impossible date would also collect "cannot be in the future". The incident
 * form renders the issue message verbatim, so a value that is not a date must
 * raise only the actionable issue. The early return enforces that.
 *
 * `todayUtcMidnight()` must be called here, at validation time. Hoisting it to
 * module scope freezes the no-future ceiling at import.
 */
const occurredOnSchema = z.string().superRefine((value, ctx) => {
  const day = parseCalendarDay(value);
  if (day === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "occurredOn must be a real YYYY-MM-DD date",
    });
    return;
  }
  if (day > todayUtcMidnight()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "occurredOn cannot be in the future",
    });
  }
});

/**
 * The optional free-text note shared by the report and edit schemas. An empty
 * note string is normalised to `undefined` so a blank is never persisted.
 *
 * `.optional()` sits outermost (after the transform): under zod 4 a
 * `.optional().transform(...)` pipe infers `note` as a required key of type
 * `string | undefined`, forcing every caller to spell out `note: undefined`.
 * Wrapping the whole pipe keeps the key omittable with identical runtime
 * semantics.
 */
const noteSchema = z
  .string()
  .trim()
  .max(2000, "note is too long")
  .transform((value) => (value ? value : undefined))
  .optional();

/**
 * A reported incident. `occurredOn` is required and stored as a calendar date
 * (`YYYY-MM-DD`, matching the `date` column); severity/note are optional.
 * The server function in `app/server/incidents` uses this as its validator, so
 * the {@link occurredOnSchema} no-future rule holds server-side and a future
 * date can never pin the recent-incident banner forever.
 */
export const reportIncidentInputSchema = z.object({
  listingId: z.string().min(1, "listingId is required"),
  occurredOn: occurredOnSchema,
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  note: noteSchema,
});
export type ReportIncidentInput = z.infer<typeof reportIncidentInputSchema>;

/** Listing a listing's incidents needs only the listing id. */
export const listIncidentsInputSchema = z.object({
  listingId: z.string().min(1, "listingId is required"),
});
export type ListIncidentsInput = z.infer<typeof listIncidentsInputSchema>;

/**
 * Editing an own incident. Carries the incident `id` and the same editable
 * fields a report accepts. The actor is the current user; ownership is
 * enforced server-side (the incident's `userId` must match) — this schema
 * carries no user id, so a caller can never spoof one.
 *
 * Shares the exact {@link occurredOnSchema} / {@link noteSchema} rules with
 * {@link reportIncidentInputSchema}, so an edit can never sneak a future or
 * impossible date past the report path.
 */
export const editIncidentInputSchema = z.object({
  id: z.string().min(1, "id is required"),
  occurredOn: occurredOnSchema,
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  note: noteSchema,
});
export type EditIncidentInput = z.infer<typeof editIncidentInputSchema>;

/** Retracting (deleting) an own incident needs only the incident id. */
export const retractIncidentInputSchema = z.object({
  id: z.string().min(1, "id is required"),
});
export type RetractIncidentInput = z.infer<typeof retractIncidentInputSchema>;

// ---------------------------------------------------------------------------
// Recency helpers — reusable across the listing banner and (later) list cards
// ---------------------------------------------------------------------------

/**
 * Whether `occurredOn` falls within the {@link RECENT_INCIDENT_WINDOW_DAYS}
 * window ending at `now`. Pure, so the listing-detail banner and the
 * browse-list card share one definition of "recent".
 *
 * Boundary rule: an incident exactly `RECENT_INCIDENT_WINDOW_DAYS` old still
 * counts as recent (inclusive); strictly older does not. A future-dated
 * incident is not recent — the report schema already rejects future dates,
 * but this is defense in depth so a bad row can never pin the banner forever.
 *
 * Recency is UTC-calendar-based: incidents are stored as dates, so both
 * `occurredOn` and `now` are floored to their UTC midnight before measuring
 * the gap. The boundary is independent of the time of day the check runs and
 * matches the basis `relativeIncidentDate` uses, so server and client agree.
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
