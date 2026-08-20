import { isStale } from "~/trust/summary";

/**
 * Pure presentation formatters for the browse card.
 *
 * Client-safe: keep this module free of `db`/server-only imports (its only
 * dependency is the pure `isStale` boundary). Every function takes `now` (or
 * the raw value) as a parameter, so it is deterministic without a clock.
 *
 * These are display cues, never a safety verdict — the headline safety state
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
 * Render a compact relative age like `"3d"`, `"5h"`, `"2mo"` for a past
 * instant, bucketed to minutes → hours → days → months. Future/near-now clamps
 * to `"just now"`. Implementation detail of {@link formatFreshness}.
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
 * The near-now bucket drops the trailing "ago" (`"Verified just now"`).
 */
function labelWith(verb: string, value: Date, now: Date): string {
  const compact = compactAgo(value, now);
  return compact === "just now" ? `${verb} just now` : `${verb} ${compact} ago`;
}

/**
 * Derive the browse card's freshness cue. Precedence follows the trust model
 * (ADR-007): a recent "got glutened" report wins outright, then a
 * within-window confirmation reads as fresh, else stale.
 *
 * - **incident** (`recentIncidentAt` present) → `"Reported {compact} ago"`,
 *   phrased from the incident's own recency.
 * - **fresh** (confirmation within the staleness window) → `"Verified …"`.
 * - **stale** (confirmation strictly older than the window) → `"Updated …"`.
 *
 * Returns `null` when there is nothing honest to show (no incident and no
 * confirmation timestamp); the caller omits the cue rather than fabricating one.
 *
 * The staleness boundary comes from the shared `isStale` (same cutoff the
 * headline safety state and the SQL sort use), so "fresh" here never drifts
 * from the card's safety verdict.
 */
export function formatFreshness(
  lastConfirmedAt: Date | null,
  recentIncidentAt: Date | null,
  now: Date,
  stalenessMonths: number
): Freshness | null {
  // An incident wins outright, phrased from its own recency.
  if (recentIncidentAt !== null) {
    return { kind: "incident", label: labelWith("Reported", recentIncidentAt, now) };
  }

  if (lastConfirmedAt === null) {
    // Never confirmed and no incident: nothing honest to phrase, so no cue.
    return null;
  }

  if (isStale(lastConfirmedAt, now, stalenessMonths)) {
    return { kind: "stale", label: labelWith("Updated", lastConfirmedAt, now) };
  }
  return { kind: "fresh", label: labelWith("Verified", lastConfirmedAt, now) };
}

/**
 * Format a distance for the card, e.g. `"0.4 mi"`. Accepts kilometres (the
 * unit the browse sort computes in) and converts to miles. One decimal place;
 * clamps negatives to `0`. Pure — a unit conversion of the already-computed
 * distance, never a recompute.
 */
export function formatDistanceLabel(distanceKm: number): string {
  const miles = Math.max(0, distanceKm) / KM_PER_MILE;
  return `${miles.toFixed(1)} mi`;
}
