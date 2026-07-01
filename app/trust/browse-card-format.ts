import { isStale } from "~/trust/summary";

/**
 * Pure presentation formatters for the redesigned browse card (AUB-61 Phase 2).
 *
 * CLIENT-SAFE: pure functions only — no DB client, no server-only imports (just
 * the pure `isStale` staleness boundary from `~/trust/summary`). Safe to import
 * from the
 * browse card / its wrapper in the client bundle. Every function takes `now` (or
 * the raw value) as a parameter so it is deterministic and unit-testable without
 * a clock. Keep it free of any `db`/server-only imports.
 *
 * These are DISPLAY cues, never a safety verdict — the headline safety state
 * (ADR-007) is the only verdict, derived separately in `~/trust/summary`.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
// Coarse calendar-month approximation — fine for a compact "ago" cue.
const MS_PER_MONTH = 30 * MS_PER_DAY;

const KM_PER_MILE = 1.609_344;

/** The three freshness kinds; each maps to a colour + icon on the card. */
export type FreshnessKind = "fresh" | "stale" | "incident";

/** A render-ready freshness cue: `{ kind, label }`. */
export interface Freshness {
  kind: FreshnessKind;
  label: string;
}

/**
 * Render a COMPACT relative age like `"3d"`, `"5h"`, `"2mo"`, `"just now"` for a
 * past instant. Coarser than `~/trust/summary`'s `formatRelativeTime` (which is
 * verbose, e.g. "3 weeks ago"): the card wants a terse chip, so we bucket to
 * minutes → hours → days → months. Future/near-now clamps to `"just now"`.
 *
 * Pure/deterministic: `now` is injected. Not exported — it is an implementation
 * detail of {@link formatFreshness}; callers get the full labelled cue instead.
 */
function compactAgo(value: Date, now: Date): string {
  const diffMs = now.getTime() - value.getTime();
  if (diffMs < MS_PER_MINUTE) {
    return "just now";
  }
  if (diffMs < MS_PER_HOUR) {
    return `${Math.floor(diffMs / MS_PER_MINUTE)}m`;
  }
  if (diffMs < MS_PER_DAY) {
    return `${Math.floor(diffMs / MS_PER_HOUR)}h`;
  }
  if (diffMs < MS_PER_MONTH) {
    return `${Math.floor(diffMs / MS_PER_DAY)}d`;
  }
  return `${Math.floor(diffMs / MS_PER_MONTH)}mo`;
}

/**
 * Compose a cue label like `"Verified 3d ago"` from a verb and a past instant.
 * The near-now bucket reads `"just now"`, so we drop the trailing "ago" there
 * (`"Verified just now"`) rather than the ungrammatical `"Verified just now ago"`.
 */
function labelWith(verb: string, value: Date, now: Date): string {
  const compact = compactAgo(value, now);
  return compact === "just now" ? `${verb} just now` : `${verb} ${compact} ago`;
}

/**
 * Derive the browse card's freshness cue from the celiac claim's recency and the
 * most recent incident. Precedence mirrors the trust model (ADR-007): a recent
 * "got glutened" report is the loudest signal and wins outright, then a
 * within-window confirmation reads as fresh/verified, else the confirmation has
 * aged past the staleness window and reads as stale/updated.
 *
 * - **incident** (`recentIncidentAt` present) → `"Reported {compact} ago"`
 *   (rendered red), phrased from the incident's own recency.
 * - **fresh** (a confirmation within the staleness window, or never-confirmed —
 *   matching `isStale`'s "null is not stale" rule) → `"Verified {compact} ago"`
 *   (green). A never-confirmed claim has no timestamp to phrase, so it returns
 *   `null` (no cue) rather than fabricating one.
 * - **stale** (a confirmation strictly older than the window) → `"Updated
 *   {compact} ago"` (slate).
 *
 * Returns `null` when there is nothing honest to show (no incident and no
 * confirmation timestamp), so the caller simply omits the cue.
 *
 * The staleness boundary comes from the shared `isStale` (same cutoff the
 * headline safety state + the SQL sort use), so "fresh" here never drifts from
 * the card's safety verdict.
 *
 * @param lastConfirmedAt The celiac claim's last confirmation, or `null`.
 * @param recentIncidentAt The most recent in-window incident's instant, or
 *   `null` when there is none. When present it takes precedence over recency.
 * @param now Reference instant (injected for determinism/tests).
 * @param stalenessMonths The active staleness window in months.
 */
export function formatFreshness(
  lastConfirmedAt: Date | null,
  recentIncidentAt: Date | null,
  now: Date,
  stalenessMonths: number
): Freshness | null {
  // Incident is the loudest cue and wins outright, phrased from its own recency.
  if (recentIncidentAt !== null) {
    return { kind: "incident", label: labelWith("Reported", recentIncidentAt, now) };
  }

  if (lastConfirmedAt === null) {
    // Never confirmed and no incident: nothing honest to phrase → no cue.
    return null;
  }

  if (isStale(lastConfirmedAt, now, stalenessMonths)) {
    return { kind: "stale", label: labelWith("Updated", lastConfirmedAt, now) };
  }
  return { kind: "fresh", label: labelWith("Verified", lastConfirmedAt, now) };
}

/**
 * Format a distance for the card, e.g. `"0.4 mi"`. Accepts kilometres (the unit
 * the browse ORDER BY / `haversineKm` compute in) and converts to miles for the
 * Denver pilot audience. One decimal place; clamps negatives to `0`.
 *
 * PURE: no clock, no I/O — a straight unit conversion of an already-computed
 * distance. Used only when the sort is `distance` and coords are present; the
 * distance value itself is reused from the distance-sort path (never recomputed).
 */
export function formatDistanceLabel(distanceKm: number): string {
  const miles = Math.max(0, distanceKm) / KM_PER_MILE;
  return `${miles.toFixed(1)} mi`;
}
