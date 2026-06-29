import { z } from "zod";
import type { incidentSeverities as DbIncidentSeverities } from "~/db/schema";

/**
 * Pure incident recency + validation helpers (issue #30, ADR-007).
 *
 * CLIENT-SAFE: this module is pure and imports NO runtime value from the DB
 * layer — only `zod` and a *type-only* reference to the schema enum (erased at
 * build). It therefore may be imported from client components, the route's
 * client bundle, and the server module alike, mirroring how #29 keeps
 * `app/trust/summary.ts` pure (type-only schema imports).
 *
 * Importing the runtime `incidentSeverities` tuple from `~/db/schema` would drag
 * `drizzle-orm/pg-core` (and transitively server-only stream code) into the
 * browser bundle and break the client build — so we declare a plain literal
 * mirror here and assert at the type level that it stays in lockstep with the DB
 * enum.
 *
 * The DB-touching reads/writes (and the `createServerFn` entry points the UI
 * calls) live in `app/server/incidents/index.ts`, which imports the constants
 * and schema from here. Never move `getDb` (or a schema value import) into this
 * file.
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
// Referenced so the unused-type rule keeps the assertion alive.
export type IncidentSeveritiesInSyncWithDb = _AssertSeveritiesMatch;

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
 * WHY THIS EXISTS (a real boundary bug, issue #45): `incidents.occurred_on` is a
 * Postgres `date` declared as Drizzle `date("occurred_on")` (`PgDateString`,
 * which passes the driver value through verbatim — no `mapFromDriverValue`). The
 * Neon HTTP driver applies a `pg-types` parser to the `date` OID that returns a
 * JS **`Date`**, not the `YYYY-MM-DD` text. Every downstream consumer —
 * `parseCalendarDay` (recency + the no-future validator), `formatIncidentDate` /
 * `relativeIncidentDate` (banner + list display) — assumes a clean string, so a
 * raw `Date` silently breaks the recent-incident banner (it never renders) and
 * the list date formatting. Normalizing once at the read boundary keeps the
 * calendar-date contract instead of teaching every consumer to also accept a
 * `Date`/ISO timestamp.
 *
 * TZ-CORRECTNESS (issue #144): `pg-types` builds the `Date` for a bare `date`
 * (OID 1082) at **LOCAL midnight** of the runtime TZ — `new Date(y, m-1, d)` —
 * NOT UTC midnight. So to recover the *stored calendar day* we must read the
 * `Date` back on the **same basis the driver wrote it**: with the LOCAL getters
 * (`getFullYear`/`getMonth`/`getDate`). Reading it with UTC getters is correct
 * only on non-positive UTC offsets (the Americas, incl. the Denver pilot, and
 * the Vercel `TZ=UTC` runtime), but is off-by-one on a positive-offset runtime
 * (e.g. `Asia/Tokyo`: stored `2026-06-28` → local-midnight `Date` → UTC getters
 * → `2026-06-27`). Local getters return the stored day in ANY runtime TZ.
 *
 * Accepts the already-correct `YYYY-MM-DD` string (returned unchanged) or a
 * `Date` (the driver's local-midnight value) and returns its `YYYY-MM-DD`
 * calendar day. A value that has no resolvable calendar day is returned coerced
 * to a string unchanged (so a genuinely malformed value still surfaces
 * downstream rather than being masked as a fabricated date).
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
  // LOCAL getters: the driver built this Date at local midnight (see above), so
  // reading it on the same (local) basis recovers the stored calendar day in any
  // runtime TZ. Do NOT switch these to the UTC getters — that reintroduces the
  // positive-offset off-by-one (#144).
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
 * A reported incident. `occurredOn` is required and stored as a calendar date
 * (`YYYY-MM-DD`, matching the `date` column); severity/note are optional. An
 * empty note string is normalised to `undefined` so we never persist a blank.
 *
 * `occurredOn` is validated as a *real* calendar date (rejecting `2026-02-31`
 * et al. before they reach the Postgres `date` column) AND constrained to not be
 * in the future — a "got glutened" report describes something that has already
 * happened. The server function in `app/server/incidents` uses this as its
 * validator, so the no-future rule is enforced server-side (not just in the UI)
 * and a future date can never pin the recent-incident banner forever.
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
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
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

/**
 * Editing an OWN incident (issue #32). Carries the incident `id` and the same
 * editable fields a report accepts — `occurredOn` (re-validated as a real, non-
 * future calendar date), optional `severity`, optional `note`. The actor is the
 * current user; ownership is enforced server-side (the incident's `userId` must
 * match) — this schema does not carry a user id, so a caller can never spoof one.
 *
 * Reuses the exact `occurredOn` rules from {@link reportIncidentInputSchema} so
 * an edit can never sneak a future or impossible date past the report path, and
 * so editing a date to outside the window correctly drops the recent-incident
 * banner (and vice versa).
 */
export const editIncidentInputSchema = z.object({
  id: z.string().min(1, "id is required"),
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
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  note: z
    .string()
    .trim()
    .max(2000, "note is too long")
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type EditIncidentInput = z.infer<typeof editIncidentInputSchema>;

/** Retracting (deleting) an OWN incident needs only the incident id. */
export const retractIncidentInputSchema = z.object({
  id: z.string().min(1, "id is required"),
});
export type RetractIncidentInput = z.infer<typeof retractIncidentInputSchema>;

// ---------------------------------------------------------------------------
// Recency helpers — reusable across the listing banner and (later) list cards
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
