import {
  BookOpen,
  ConciergeBell,
  Flame,
  type LucideIcon,
  Replace,
  ShieldCheck,
} from "lucide-react";
import type { SafetyState } from "~/components/SafetySignal";
import type { ClaimAttribute } from "~/db/schema";
import type { ClaimAggregate } from "~/server/attestations";

/**
 * Pure trust roll-up derivation (ADR-007).
 *
 * The transparent trust summary is a roll-up of visible evidence — never a
 * secret score. Everything here derives purely from a {@link ClaimAggregate}
 * (confirm/dispute counts + `lastConfirmedAt` recency), itself derived from
 * attestation rows the user can also see. No hidden weighting, no opaque
 * formula (docs/agents/domain.md → Trust Model, "the summary must remain
 * explainable").
 *
 * Client-safe: keep this module free of any `db`/server-only imports.
 */

// ---------------------------------------------------------------------------
// Attribute labels — the human-readable name for each taxonomy claim
// ---------------------------------------------------------------------------

/**
 * Human-readable label per claim attribute (the GF taxonomy in
 * docs/agents/domain.md). Keyed by the `claim_attribute` enum so the mapping
 * is exhaustive at compile time — a new taxonomy value forces a label here.
 *
 * The headline `celiac_safe` attribute is labelled "Celiac-safe": every
 * listing is assumed to have gluten-free options, so the only community
 * safety question is "is it celiac-safe?" — confirm ⇒ celiac-safe, dispute ⇒
 * no badge.
 */
export const CLAIM_ATTRIBUTE_LABELS: Record<ClaimAttribute, string> = {
  celiac_safe: "Celiac-safe",
  dedicated_fryer: "Dedicated fryer",
  dedicated_gf_menu: "Dedicated GF menu",
  off_menu_gf_on_request: "Off-menu GF on request",
  gf_substitutes: "GF substitutes",
};

/** The display label for a claim attribute. */
export function claimAttributeLabel(attribute: ClaimAttribute): string {
  return CLAIM_ATTRIBUTE_LABELS[attribute];
}

/**
 * A distinct lucide glyph per claim attribute — shape reinforces attribute
 * identity on compact surfaces, independent of colour. Exhaustive by the
 * `ClaimAttribute` key, so a new taxonomy value forces an icon here too.
 */
export const CLAIM_ATTRIBUTE_ICONS: Record<ClaimAttribute, LucideIcon> = {
  celiac_safe: ShieldCheck,
  dedicated_fryer: Flame,
  dedicated_gf_menu: BookOpen,
  off_menu_gf_on_request: ConciergeBell,
  gf_substitutes: Replace,
};

/**
 * One-line clarifier for what confirm vs dispute means on an attribute — one
 * source of truth for the Community-claims surface and the add-listing
 * attestation step. Keyed by the `claim_attribute` enum so the mapping is
 * exhaustive at compile time. The headline gloss describes what celiac-safe
 * means rather than button captions, because the two surfaces label their
 * controls differently.
 */
export const CLAIM_ATTRIBUTE_DESCRIPTIONS: Record<ClaimAttribute, string> = {
  celiac_safe:
    "Celiac-safe means the kitchen takes cross-contamination seriously, not just gluten-free options on the menu.",
  dedicated_fryer:
    "A separate fryer for gluten-free food (shared fryer oil is a major cross-contamination risk).",
  dedicated_gf_menu: "A dedicated gluten-free menu, not just a few marked items on the main one.",
  off_menu_gf_on_request:
    "Staff will prepare gluten-free options on request even if they aren't listed.",
  gf_substitutes: "Offers gluten-free swaps like GF buns, pasta, or bread.",
};

/** The confirm/dispute clarifier for an attribute. */
export function claimAttributeDescription(attribute: ClaimAttribute): string {
  return CLAIM_ATTRIBUTE_DESCRIPTIONS[attribute];
}

// ---------------------------------------------------------------------------
// Count formatting — the confirm/dispute distribution
// ---------------------------------------------------------------------------

/**
 * Format the confirm/dispute distribution as visible counts, e.g.
 * `"8 confirm / 1 dispute"`. Always shows both sides (including zeroes) so the
 * distribution is never misread — "8 confirm" alone would hide disputes.
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
 * Coarse by design: the trust summary wants "how fresh is this consensus",
 * not second-precision. Future dates (clock skew) clamp to "just now".
 * Returns `null` for a `null` instant (a claim never confirmed) so callers
 * render an honest "not yet confirmed" rather than a fabricated time.
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
 * The instant marking the staleness boundary: a confirmation at or after this
 * instant is "fresh", one strictly before it is "stale". Single source of
 * truth so the SQL sort/filter in `app/server/listings/browse.ts`
 * (`buildOrderBy`) derives its cutoff the same way the displayed glance does
 * — no drift between the card and the DB ordering (ADR-007).
 *
 * Boundary rule (so SQL and JS agree at the exact-equality instant): a
 * confirmation exactly `stalenessMonths` old is classified fresh (inclusive
 * lower bound); a claim is stale only once its age strictly exceeds the
 * window. The SQL builder mirrors this as `lastConfirmedAt >= cutoff`.
 */
export function stalenessCutoff(
  now: Date = new Date(),
  stalenessMonths: number = DEFAULT_STALENESS_MONTHS
): Date {
  return new Date(now.getTime() - stalenessMonths * MS_PER_MONTH);
}

/**
 * Whether a claim's last confirmation is older than the staleness window. A
 * never-confirmed claim is not "stale" — it has no recency to age out and
 * shows "not yet confirmed" instead (ADR-007). Window in months, defaulting
 * to the ADR-007 value; the caller can pass the admin-tuned setting.
 *
 * Derives the boundary from {@link stalenessCutoff} so it stays in lockstep
 * with the SQL `fresh` predicate: stale ⟺ the confirmation is strictly before
 * the cutoff (a confirmation exactly on the edge counts as fresh).
 */
export function isStale(
  lastConfirmedAt: Date | null,
  now: Date = new Date(),
  stalenessMonths: number = DEFAULT_STALENESS_MONTHS
): boolean {
  if (lastConfirmedAt === null) {
    return false;
  }
  return lastConfirmedAt.getTime() < stalenessCutoff(now, stalenessMonths).getTime();
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
  /**
   * True when this claim was suggested by the curator bot ("Aubrey's Bot")
   * and no real user has attested it yet. Drives the "Suggested by Aubrey's
   * Bot" badge. A suggestion is provenance, not evidence (ADR-007): mutually
   * exclusive with `hasEvidence` — the first real vote clears the suggestion
   * — so the row shows the badge instead of the empty state, never a fake
   * count.
   */
  suggested: boolean;
}

/**
 * Roll a `(attribute, aggregate)` pair up into the render-ready summary above —
 * the single derivation the per-claim summary component renders.
 */
export function summarizeClaim(
  attribute: ClaimAttribute,
  aggregate: Pick<ClaimAggregate, "confirmCount" | "disputeCount" | "lastConfirmedAt"> &
    Partial<Pick<ClaimAggregate, "suggested">>,
  now: Date = new Date(),
  stalenessMonths: number = DEFAULT_STALENESS_MONTHS
): ClaimTrustSummary {
  const evidence = hasEvidence(aggregate);
  return {
    attribute,
    label: claimAttributeLabel(attribute),
    confirmCount: aggregate.confirmCount,
    disputeCount: aggregate.disputeCount,
    countsLabel: formatVoteCounts(aggregate),
    recencyLabel: formatLastConfirmed(aggregate.lastConfirmedAt, now),
    hasEvidence: evidence,
    stale: isStale(aggregate.lastConfirmedAt, now, stalenessMonths),
    // A suggestion only shows while there is no real evidence; the first real
    // vote clears `suggestedBy` server-side, but guard here too so a badge
    // can never sit beside real counts. `suggested` is optional so callers
    // with a bare {confirm,dispute,lastConfirmed} Pick stay valid.
    suggested: (aggregate.suggested ?? false) && !evidence,
  };
}

// ---------------------------------------------------------------------------
// Positive consensus — "confirms outweigh disputes", the filter-match rule
// ---------------------------------------------------------------------------

/**
 * Whether a claim has positive community consensus: there is evidence and
 * confirms strictly outnumber disputes.
 *
 * The single, explainable rule for "the community has affirmed this
 * attribute" — the same `confirmCount > disputeCount` reading
 * {@link deriveHeadlineSafetyState} uses. A tie is deliberately not positive:
 * contested evidence must never read as affirmed (a celiac could be hurt by
 * an overstated match).
 *
 * Recency/staleness is intentionally not part of this rule: a
 * stale-but-uncontested claim still represents a real, visible community
 * consensus and the taxonomy filter should surface it. The card's glance
 * flags staleness separately.
 *
 * Used by the GF taxonomy browse filter: a listing matches an attribute only
 * when its claim has positive consensus — never merely because a `claims` row
 * exists.
 */
export function hasPositiveConsensus(
  aggregate: Pick<ClaimAggregate, "confirmCount" | "disputeCount">
): boolean {
  return hasEvidence(aggregate) && aggregate.confirmCount > aggregate.disputeCount;
}

// ---------------------------------------------------------------------------
// Headline safety state — celiac-safe or nothing, from visible evidence
// ---------------------------------------------------------------------------

/**
 * Derive the headline {@link SafetyState} for the `celiac_safe`
 * claim from its aggregate — the single seam the headline `SafetySummary` wires.
 *
 * Honest by construction (a celiac could get hurt by a fabricated rating):
 * - **No evidence** (zero confirms and disputes) → `null`. No badge.
 * - **Disputes tie or outnumber confirms** → `null`. Disputes suppress the
 *   badge; a disputed claim and an unattested one are indistinguishable on
 *   every surface by design (owner decision 2026-08-25). Checked first — a
 *   live dispute majority must never be masked by staleness, since
 *   `lastConfirmedAt` is only bumped by confirms, so a claim confirmed long
 *   ago then freshly disputed would otherwise read as a neutral "may be
 *   stale". The dispute counts stay visible on the claim row.
 * - **Stale** confirmation (older than the window) while confirms lead →
 *   `"stale"`. Recency is weighted (ADR-007): an aged, uncontested consensus
 *   is flagged, not trusted as fresh.
 * - **Confirms strictly outnumber disputes** and the confirmation is fresh →
 *   `"celiac-safe"`.
 *
 * Not a score: a direct reading of the visible confirm/dispute counts and
 * recency, reproducible by any user looking at the same evidence.
 */
export function deriveHeadlineSafetyState(
  aggregate: Pick<ClaimAggregate, "confirmCount" | "disputeCount" | "lastConfirmedAt">,
  now: Date = new Date(),
  stalenessMonths: number = DEFAULT_STALENESS_MONTHS
): SafetyState | null {
  if (!hasEvidence(aggregate)) {
    return null;
  }
  // Contested first: a live dispute majority outranks staleness so fresh harm
  // is never hidden behind an "outdated" chip (the confirm-only recency
  // signal can be stale even as disputes pile up).
  if (aggregate.confirmCount <= aggregate.disputeCount) {
    return null;
  }
  // Confirms lead, but an aged consensus is flagged rather than trusted.
  if (isStale(aggregate.lastConfirmedAt, now, stalenessMonths)) {
    return "stale";
  }
  return "celiac-safe";
}

/**
 * The confirmation-derived cues the listing-detail hero shows beside the
 * headline badge: the "Verified …" recency phrase and the confirmation count.
 *
 * Gated on {@link hasPositiveConsensus} — the same rule
 * `deriveListingTrustGlance` applies to the browse card's freshness cue and
 * evidence meta, so the two surfaces suppress in lockstep. A contested claim
 * yields `{ verifiedRelative: null, confirmations: 0 }`: byte-identical to an
 * unattested listing, which is what makes the hero honest. Suppressing only
 * the badge would leak the withheld verdict straight back through this strip
 * — "Verified 3 days ago · 3 confirmations" sitting where a badge is missing
 * reads as reassurance the community never gave.
 *
 * Scope: these hero cues only. The detail page's per-claim rows keep the full
 * confirm/dispute distribution (`summarizeClaim`) — that is where a contest is
 * meant to be legible — and incident signals are untouched.
 *
 * `null`/`undefined` (a listing with no celiac claim) yields the same empty
 * pair, so the caller never branches on the claim's existence.
 */
export function deriveHeadlineMeta(
  aggregate:
    | Pick<ClaimAggregate, "confirmCount" | "disputeCount" | "lastConfirmedAt">
    | null
    | undefined,
  now: Date = new Date()
): { verifiedRelative: string | null; confirmations: number } {
  const affirmed = aggregate !== null && aggregate !== undefined && hasPositiveConsensus(aggregate);
  if (!affirmed) {
    return { verifiedRelative: null, confirmations: 0 };
  }
  return {
    verifiedRelative: formatRelativeTime(aggregate.lastConfirmedAt, now),
    confirmations: aggregate.confirmCount,
  };
}

// ---------------------------------------------------------------------------
// Safety tier — the displayed headline state as a sortable rank
// ---------------------------------------------------------------------------

/**
 * The browse "Most trusted" sort rank for a celiac aggregate — higher is safer
 * and sorts first. The rank derives directly from {@link deriveHeadlineSafetyState}
 * so it can never drift from the state the card displays (ADR-007: the sort
 * must be reproducible from the visible glance). The server reproduces these
 * exact tiers in SQL (`buildOrderBy` in `app/server/listings/browse.ts`);
 * this pure function is the single, testable specification of the contract.
 *
 *   4  celiac-safe — fresh, uncontested confirm-majority (the safest, first)
 *   3  stale       — confirm-majority but past the staleness window
 *   1  no badge    — `null` state: unattested OR disputed
 *
 * Tier 2 is deliberately vacant: the numbers are kept as-is so the SQL mirror
 * stays a minimal diff. `null`/`undefined` (a listing with no celiac claim)
 * ranks lowest (1).
 */
export function safetyTierRank(
  aggregate:
    | Pick<ClaimAggregate, "confirmCount" | "disputeCount" | "lastConfirmedAt">
    | null
    | undefined,
  now: Date = new Date(),
  stalenessMonths: number = DEFAULT_STALENESS_MONTHS
): number {
  const state = aggregate ? deriveHeadlineSafetyState(aggregate, now, stalenessMonths) : null;
  switch (state) {
    case "celiac-safe":
      return 4;
    case "stale":
      return 3;
    default:
      return 1; // null → unattested or disputed
  }
}
