/**
 * Pure date-formatting helpers for incident reports (#30). Kept out of the React
 * components so they are trivially unit-testable and reusable by both the
 * listing banner and the incident list (and, later, the #33 list-card signal).
 *
 * Incident dates are stored as calendar dates (`YYYY-MM-DD`, the `date` column).
 * We parse them at UTC midnight so a date never drifts by a day across
 * timezones — a "got glutened on the 1st" must read as the 1st everywhere.
 */

/** Parse a `YYYY-MM-DD` calendar date at UTC midnight. */
function parseCalendarDate(occurredOn: string): Date {
  return new Date(`${occurredOn}T00:00:00Z`);
}

/**
 * Human-readable absolute date, e.g. `Jun 1, 2026`. Formatted in UTC to match
 * the stored calendar date (no timezone drift).
 */
export function formatIncidentDate(occurredOn: string): string {
  const date = parseCalendarDate(occurredOn);
  if (Number.isNaN(date.getTime())) {
    return occurredOn;
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Floor a `Date` to its UTC-midnight epoch ms (calendar-day granularity). */
function utcMidnightMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Coarse relative phrasing for the warning banner, e.g. `today`, `3 days ago`,
 * `2 weeks ago`, `4 months ago`. Coarse on purpose — the exact date is shown
 * alongside it, so this only needs to convey freshness at a glance.
 *
 * Recency is **UTC-calendar-based** — both the incident date and `now` are
 * floored to UTC midnight before measuring the gap, matching `isRecentIncident`
 * so SSR and client render the same phrase (no hydration flicker) and so a
 * Denver (UTC-7) report near midnight doesn't read off-by-one. Pass `now` once
 * (resolved server-side and threaded down) rather than relying on the default,
 * which would differ between server and browser.
 */
export function relativeIncidentDate(occurredOn: string, now: Date = new Date()): string {
  const date = parseCalendarDate(occurredOn);
  if (Number.isNaN(date.getTime())) {
    return occurredOn;
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.floor((utcMidnightMs(now) - utcMidnightMs(date)) / dayMs);

  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "1 month ago";
  return `${Math.floor(days / 30)} months ago`;
}

/** Capitalised severity label for display, e.g. `mild` -> `Mild`. */
export function formatSeverity(severity: string): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}
