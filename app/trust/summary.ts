import type { SafetyState } from "~/components/SafetySignal";
import type { ClaimAttribute } from "~/db/schema";
import type { ClaimAggregate } from "~/server/attestations";

/**
 * Pure trust roll-up derivation (issue #29, ADR-007).
 *
 * The transparent trust summary is a *roll-up of visible evidence* — never a
 * secret score. Everything in here is derived purely from a {@link ClaimAggregate}
 * (confirm/dispute counts + `lastConfirmedAt` recency), which is itself derived
 * from attestation rows the user can also see. No hidden weighting, no opaque
 * formula (docs/agents/domain.md → Trust Model, "the summary must remain
 * explainable").
 *
 * CLIENT-SAFE: this module is pure and imports NO database client, so it can be
 * shared by the listing-detail page and the browse-list cards (#33) alike. Keep
 * it free of any `db`/server-only imports.
 */

// ---------------------------------------------------------------------------
// Attribute labels — the human-readable name for each taxonomy claim
// ---------------------------------------------------------------------------

/**
 * Human-readable label per claim attribute (the GF taxonomy in
 * docs/agents/domain.md). Keyed by the `claim_attribute` enum so the mapping
 * is exhaustive at compile time — add a taxonomy value and TypeScript forces a
 * label here too.
 */
export const CLAIM_ATTRIBUTE_LABELS: Record<ClaimAttribute, string> = {
  celiac_safe_vs_gluten_friendly: "Celiac-safe vs. gluten-friendly",
  dedicated_fryer: "Dedicated fryer",
  cross_contamination_protocol: "Cross-contamination protocol",
  dedicated_gf_menu: "Dedicated GF menu",
  off_menu_gf_on_request: "Off-menu GF on request",
  staff_knowledge: "Staff knowledge",
  gf_substitutes: "GF substitutes",
};

/** The display label for a claim attribute. */
export function claimAttributeLabel(attribute: ClaimAttribute): string {
  return CLAIM_ATTRIBUTE_LABELS[attribute];
}

// ---------------------------------------------------------------------------
// Count formatting — the confirm/dispute distribution
// ---------------------------------------------------------------------------

/**
 * Format the confirm/dispute distribution as visible counts, e.g.
 * `"8 confirm / 1 dispute"`. Always shows BOTH sides (including zeroes) so the
 * distribution is never misread — "8 confirm" alone hides that there were also
 * disputes. Singular/plural is handled per side.
 */
export function formatVoteCounts(
  aggregate: Pick<ClaimAggregate, "confirmCount" | "disputeCount">
): string {
  const confirm = `${aggregate.confirmCount} confirm`;
  const dispute = `${aggregate.disputeCount} dispute`;
  return `${confirm} / ${dispute}`;
}

/** Total number of attestations backing a claim (confirm + dispute). */
export function totalVotes(
  aggregate: Pick<ClaimAggregate, "confirmCount" | "disputeCount">
): number {
  return aggregate.confirmCount + aggregate.disputeCount;
}

/** Whether a claim has any attestation evidence at all. */
export function hasEvidence(
  aggregate: Pick<ClaimAggregate, "confirmCount" | "disputeCount">
): boolean {
  return totalVotes(aggregate) > 0;
}

// ---------------------------------------------------------------------------
// Recency — "last confirmed N ago", relative to now
// ---------------------------------------------------------------------------

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;
// Calendar-month / year approximations are fine for a coarse "ago" label.
const MS_PER_MONTH = 30 * MS_PER_DAY;
const MS_PER_YEAR = 365 * MS_PER_DAY;

/**
 * Render a coarse relative-time string for a past instant, e.g. `"3 weeks ago"`,
 * `"just now"`, `"yesterday"`. Used for the "last confirmed …" recency cue.
 *
 * Coarse by design: the trust summary wants "how fresh is this consensus", not
 * second-precision. Future dates (clock skew) clamp to "just now". Returns
 * `null` for a `null` instant (a claim never confirmed) so callers render an
 * honest "not yet confirmed" rather than a fabricated time.
 */
export function formatRelativeTime(value: Date | null, now: Date = new Date()): string | null {
  if (value === null) {
    return null;
  }

  const diffMs = now.getTime() - value.getTime();

  // Future or essentially-now: don't render a misleading "in N" or negative.
  if (diffMs < MS_PER_MINUTE) {
    return "just now";
  }
  if (diffMs < MS_PER_HOUR) {
    return plural(Math.floor(diffMs / MS_PER_MINUTE), "minute");
  }
  if (diffMs < MS_PER_DAY) {
    return plural(Math.floor(diffMs / MS_PER_HOUR), "hour");
  }
  if (diffMs < 2 * MS_PER_DAY) {
    return "yesterday";
  }
  if (diffMs < MS_PER_WEEK) {
    return plural(Math.floor(diffMs / MS_PER_DAY), "day");
  }
  if (diffMs < MS_PER_MONTH) {
    return plural(Math.floor(diffMs / MS_PER_WEEK), "week");
  }
  if (diffMs < MS_PER_YEAR) {
    return plural(Math.floor(diffMs / MS_PER_MONTH), "month");
  }
  return plural(Math.floor(diffMs / MS_PER_YEAR), "year");
}

/** `1 → "1 week ago"`, `3 → "3 weeks ago"`. */
function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

/**
 * The recency phrase for a claim's summary line, e.g.
 * `"last confirmed 3 weeks ago"`, or `"not yet confirmed"` when there is no
 * confirmation timestamp. Never fabricates a time.
 */
export function formatLastConfirmed(lastConfirmedAt: Date | null, now: Date = new Date()): string {
  const relative = formatRelativeTime(lastConfirmedAt, now);
  return relative === null ? "not yet confirmed" : `last confirmed ${relative}`;
}

// ---------------------------------------------------------------------------
// Staleness — a confirmation older than the staleness window is "may be stale"
// ---------------------------------------------------------------------------

/** Default staleness window in months (ADR-007; admin-tunable AppSetting). */
export const DEFAULT_STALENESS_MONTHS = 6;

/**
 * Whether a claim's last confirmation is older than the staleness window. A
 * never-confirmed claim is NOT "stale" — it simply has no recency to age out
 * (it shows "not yet confirmed" instead). Window in months, defaulting to the
 * ADR-007 value; the caller can pass the admin-tuned setting.
 */
export function isStale(
  lastConfirmedAt: Date | null,
  now: Date = new Date(),
  stalenessMonths: number = DEFAULT_STALENESS_MONTHS
): boolean {
  if (lastConfirmedAt === null) {
    return false;
  }
  const ageMs = now.getTime() - lastConfirmedAt.getTime();
  return ageMs > stalenessMonths * MS_PER_MONTH;
}

// ---------------------------------------------------------------------------
// Per-claim summary roll-up — the full derived view a card/row renders
// ---------------------------------------------------------------------------

/**
 * The fully-derived, render-ready summary for one claim: its label, the visible
 * count distribution, the recency phrase, and whether it has aged out. Every
 * field is explainable from the aggregate (and thus from visible evidence).
 */
export interface ClaimTrustSummary {
  attribute: ClaimAttribute;
  label: string;
  confirmCount: number;
  disputeCount: number;
  /** "8 confirm / 1 dispute". */
  countsLabel: string;
  /** "last confirmed 3 weeks ago" | "not yet confirmed". */
  recencyLabel: string;
  /** True once there is at least one confirm or dispute. */
  hasEvidence: boolean;
  /** True when a past confirmation is older than the staleness window. */
  stale: boolean;
}

/**
 * Roll a `(attribute, aggregate)` pair up into the render-ready summary above —
 * the single derivation the per-claim summary component renders.
 */
export function summarizeClaim(
  attribute: ClaimAttribute,
  aggregate: Pick<ClaimAggregate, "confirmCount" | "disputeCount" | "lastConfirmedAt">,
  now: Date = new Date(),
  stalenessMonths: number = DEFAULT_STALENESS_MONTHS
): ClaimTrustSummary {
  return {
    attribute,
    label: claimAttributeLabel(attribute),
    confirmCount: aggregate.confirmCount,
    disputeCount: aggregate.disputeCount,
    countsLabel: formatVoteCounts(aggregate),
    recencyLabel: formatLastConfirmed(aggregate.lastConfirmedAt, now),
    hasEvidence: hasEvidence(aggregate),
    stale: isStale(aggregate.lastConfirmedAt, now, stalenessMonths),
  };
}

// ---------------------------------------------------------------------------
// Headline safety state — celiac-safe vs gluten-friendly, from visible evidence
// ---------------------------------------------------------------------------

/**
 * Derive the headline {@link SafetyState} for the `celiac_safe_vs_gluten_friendly`
 * claim from its aggregate — the single seam the headline `SafetySummary` wires.
 *
 * HONEST BY CONSTRUCTION (a celiac could get hurt by a fabricated rating):
 * - **No evidence** (zero confirms and disputes) → `null`. The headline renders
 *   its existing "Not yet attested" empty state; we never invent a verdict.
 * - **Disputes tie or outnumber confirms** → `"gluten-friendly"`: the safer,
 *   lower claim. This is checked FIRST — a live dispute majority must NEVER be
 *   masked by staleness. `lastConfirmedAt` is only bumped by confirms, so a
 *   claim confirmed long ago then freshly disputed (e.g. 1 confirm / 10 dispute)
 *   would otherwise read as a neutral "may be stale" and bury contested fresh
 *   evidence. We deliberately fall back to the less reassuring state when the
 *   evidence is contested — never overstate safety.
 * - **Stale** confirmation (older than the window) while confirms lead →
 *   `"stale"`. Recency is weighted (ADR-007): an aged, uncontested consensus is
 *   flagged, not trusted as fresh.
 * - **Confirms strictly outnumber disputes** and the confirmation is fresh →
 *   `"celiac-safe"`: the community consensus, from visible counts, is that
 *   cross-contamination is taken seriously.
 *
 * This is NOT a score: it is a direct reading of the visible confirm/dispute
 * counts and recency, reproducible by any user looking at the same evidence.
 */
export function deriveHeadlineSafetyState(
  aggregate: Pick<ClaimAggregate, "confirmCount" | "disputeCount" | "lastConfirmedAt">,
  now: Date = new Date(),
  stalenessMonths: number = DEFAULT_STALENESS_MONTHS
): SafetyState | null {
  if (!hasEvidence(aggregate)) {
    return null;
  }
  // Contested-first: a live dispute majority outranks staleness so fresh harm
  // is never hidden behind an "outdated" chip (the confirm-only recency signal
  // can be stale even as disputes pile up).
  if (aggregate.confirmCount <= aggregate.disputeCount) {
    return "gluten-friendly";
  }
  // Confirms lead, but an aged consensus is flagged rather than trusted.
  if (isStale(aggregate.lastConfirmedAt, now, stalenessMonths)) {
    return "stale";
  }
  return "celiac-safe";
}
