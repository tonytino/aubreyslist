import type { SafetyState } from "~/components/SafetySignal";
import { CLAIM_ATTRIBUTES, type ClaimAttribute } from "~/listings/taxonomy";
import type { ClaimAggregate } from "~/server/attestations";
import { type Freshness, formatFreshness } from "~/trust/browse-card-format";
import {
  DEFAULT_STALENESS_MONTHS,
  deriveHeadlineSafetyState,
  hasPositiveConsensus,
} from "~/trust/summary";

/**
 * Pure at-a-glance trust derivation for the browse list.
 *
 * Client-safe: imports no database client — only pure derivations, the
 * client-safe taxonomy tuple, and type-only references. Keep it free of any
 * `db`/server-only imports.
 *
 * The browse card shows the same honest signals as the listing-detail page,
 * condensed to a single glance:
 *
 * - **Headline safety state** — derived from the celiac claim's visible
 *   aggregate via {@link deriveHeadlineSafetyState}. `null` when there is no
 *   claim, no evidence, or the claim is disputed: the card renders no safety
 *   badge at all, never a fabricated verdict (a celiac could be hurt).
 * - **Recent-incident flag** — recent harm flags the card regardless of older
 *   confirmations (ADR-007, domain.md → Trust Model).
 * - **Evidence counts** — celiac-claim confirmations and distinct
 *   contributors, a plain count of the visible attestation rows.
 * - **Freshness cue** — a compact `{ kind, label }` recency descriptor from
 *   `formatFreshness` (incident → fresh → stale precedence).
 *
 * Contested claims are suppressed to the unattested glance. When disputes tie
 * or outnumber confirms, the badge, the freshness cue AND the evidence counts
 * are all withheld, so a contested card is byte-identical to a never-reviewed
 * one: the app declines to adjudicate rather than hinting at a verdict through
 * a side channel. The contest stays legible where it belongs, on the
 * detail-page claim row (`summarizeClaim`, untouched by this rule). Incident
 * signals are exempt — recent harm always surfaces.
 * - **Bot-suggestion provenance** — which attributes carry a live curator-bot
 *   suggestion. Provenance, never evidence (ADR-007): it never influences the
 *   safety verdict or the evidence counts.
 * - **Confirmed claim badges** — non-headline attributes with positive
 *   community consensus, deduped against the suggested set so an attribute is
 *   never both confirmed and suggested.
 *
 * A roll-up of visible evidence, never a secret score — the same reading any
 * user gets from the listing-detail page.
 */

/** Community evidence counts a browse card surfaces beside the safety verdict. */
export interface ListingEvidence {
  /** Confirmations on the celiac claim (its `confirmCount`). */
  confirmations: number;
  /** Distinct people who attested (confirmed or disputed) the celiac claim. */
  contributors: number;
}

/** The minimal, render-ready trust glance one browse card needs. */
export interface ListingTrustGlance {
  /**
   * The headline celiac-safe (or stale) state, or `null` when there is no
   * celiac claim, no attestation evidence, or disputes tie/outnumber confirms.
   * `null` means the card renders no safety badge — never a fabricated verdict.
   */
  safetyState: SafetyState | null;
  /** Whether a recent "got glutened" incident flags this listing. */
  hasRecentIncident: boolean;
  /**
   * Community evidence counts (celiac-claim confirmations + distinct
   * contributors), or `null` when the listing has no celiac claim, no
   * evidence, or a contested one (which reads as unattested).
   */
  evidence: ListingEvidence | null;
  /**
   * The render-ready freshness cue (`{ kind, label }`), or `null` when there is
   * nothing honest to show (no incident and no usable confirmation timestamp).
   * A contested claim's confirmation recency is withheld the same way its badge
   * is; an incident cue still comes through.
   */
  freshness: Freshness | null;
  /**
   * True when this listing carries at least one live (unvoted) curator-bot
   * suggestion on any visible claim — i.e. whenever
   * {@link suggestedAttributes} is non-empty. Drives the card's "Suggested by
   * Aubrey's Bot" label. Provenance, not a verdict (ADR-007): shown whenever
   * suggestions are live — including alongside real community evidence on
   * other claims — but it never influences `safetyState` or `evidence`, which
   * derive from evidence only.
   */
  suggestedByBot: boolean;
  /**
   * The claim attributes with a still-live curator-bot suggestion (no real
   * vote yet), deduped and in taxonomy order. Each renders as a bot-provenance
   * badge — styled as a suggestion, never as a community-confirmed verdict
   * (ADR-007). Empty when nothing is suggested.
   */
  suggestedAttributes: ClaimAttribute[];
  /**
   * The non-headline claim attributes with confirmed positive community
   * consensus (`hasPositiveConsensus`), deduped and in taxonomy order. Each
   * renders as a non-suggested claim badge — real community evidence, matching
   * the listing-detail page's `confirmed` badges. The headline
   * `celiac_safe` attribute is excluded (it is the
   * {@link safetyState} verdict, not a badge). Deduped against
   * {@link suggestedAttributes} so an attribute is never both confirmed and
   * suggested at once. Empty when nothing is confirmed.
   */
  confirmedAttributes: ClaimAttribute[];
}

/** Dedupe + order attributes by the canonical taxonomy order (stable render order). */
function normalizeAttributes(attributes: readonly ClaimAttribute[]): ClaimAttribute[] {
  return CLAIM_ATTRIBUTES.filter((attribute) => attributes.includes(attribute));
}

/**
 * Derive a listing's at-a-glance trust from its `celiac_safe`
 * aggregate, a distinct-contributor count, and the most recent in-window
 * incident's instant.
 *
 * The aggregate is optional (not every listing has a celiac claim row);
 * `null`/`undefined` yields a `null` `safetyState` (no badge) and `null`
 * `evidence`, exactly as a claim with no evidence would.
 *
 * A contested aggregate (evidence exists but confirms do not outnumber
 * disputes) collapses to that same glance: no badge, no confirmation-derived
 * freshness cue, no evidence counts. Partial suppression would leak the
 * verdict the badge withholds — "8 confirmations" beside an empty badge slot
 * reads as a downgrade the community never voted for, and it is a cue an
 * unattested card cannot show.
 *
 * Every confirmation-derived cue is gated on the single `hasPositiveConsensus`
 * rule, so the glance cannot report recency for a consensus it will not badge.
 * That is also the exact rule `recentExists` mirrors in SQL, which is what
 * keeps the "Recently verified" filter from returning badge-less cards.
 *
 * `hasRecentIncident` is derived from `recentIncidentAt` so the two can never
 * disagree; the freshness cue phrases the incident from its own recency.
 *
 * `suggestedAttributes` is the set of attributes — across all of the listing's
 * visible claims — that carry a live curator-bot suggestion (`suggested_by IS
 * NOT NULL`). It is batched server-side and threaded in as plain data so this
 * module stays pure and db-free. The headline celiac claim's own `suggested`
 * flag is folded in as a fallback for callers without the batched set, only
 * while that claim has no votes (the first real vote clears the suggestion).
 * The result feeds `suggestedAttributes`/`suggestedByBot` only: a suggestion
 * is provenance, never evidence, so it can never fabricate or alter the
 * safety verdict — but it is surfaced even when real evidence exists on other
 * claims, because provenance stays true regardless of evidence.
 *
 * `confirmedAttributes` is the set of non-headline attributes with confirmed
 * positive community consensus, batched server-side the same way. It is
 * deduped against the suggested set (mutually exclusive by construction:
 * consensus needs a confirm, a live suggestion needs zero votes) so the card
 * never double-renders one attribute as both evidence and provenance.
 */
export function deriveListingTrustGlance(
  celiacAggregate:
    | (Pick<ClaimAggregate, "confirmCount" | "disputeCount" | "lastConfirmedAt"> &
        Partial<Pick<ClaimAggregate, "suggested">>)
    | null
    | undefined,
  contributors: number,
  recentIncidentAt: Date | null,
  now: Date = new Date(),
  stalenessMonths: number = DEFAULT_STALENESS_MONTHS,
  suggestedAttributes: readonly ClaimAttribute[] = [],
  confirmedAttributes: readonly ClaimAttribute[] = []
): ListingTrustGlance {
  const hasEvidence =
    celiacAggregate !== null &&
    celiacAggregate !== undefined &&
    celiacAggregate.confirmCount + celiacAggregate.disputeCount > 0;

  // The one gate on every confirmation-derived cue: confirms must outnumber
  // disputes. The same `hasPositiveConsensus` rule the headline state, the
  // taxonomy filter and the `recent` quick filter's SQL read, so the four
  // cannot drift. Phrased positively (rather than as "contested") so a claim
  // with no consensus to report — contested or unattested — takes one path.
  const affirmed =
    celiacAggregate !== null &&
    celiacAggregate !== undefined &&
    hasPositiveConsensus(celiacAggregate);

  // An unaffirmed claim's confirmation recency is withheld with its badge, so
  // the cue cannot phrase "Verified 3d ago" for a listing the app refuses to
  // badge. `formatFreshness` still resolves an incident from its own instant.
  const lastConfirmedAt = affirmed ? celiacAggregate.lastConfirmedAt : null;

  // Fallback fold-in of the headline celiac claim's own suggestion flag, for
  // callers that don't batch the per-attribute set. Gated per-claim on "no
  // votes on that claim" (a vote clears the suggestion server-side) — not a
  // gate on the label itself.
  const celiacSuggested = (celiacAggregate?.suggested ?? false) && !hasEvidence;
  const suggested = normalizeAttributes(
    celiacSuggested ? [...suggestedAttributes, "celiac_safe"] : suggestedAttributes
  );

  // Confirmed non-headline attributes, taxonomy-ordered and deduped against
  // the suggested set so an attribute never renders as both evidence and
  // provenance. Mutually exclusive by construction (consensus needs a confirm;
  // a live suggestion needs zero votes), but the filter guards against a
  // transient overlap double-badging the card.
  const confirmed = normalizeAttributes(confirmedAttributes).filter(
    (attribute) => !suggested.includes(attribute)
  );

  return {
    safetyState: celiacAggregate
      ? deriveHeadlineSafetyState(celiacAggregate, now, stalenessMonths)
      : null,
    hasRecentIncident: recentIncidentAt !== null,
    // Only surface counts when confirms actually lead — a claim row with zero
    // votes, no claim at all, or a contested one surfaces nothing: never "0
    // confirmations", and never a count sitting beside an empty badge slot.
    evidence: affirmed ? { confirmations: celiacAggregate.confirmCount, contributors } : null,
    freshness: formatFreshness(lastConfirmedAt, recentIncidentAt, now, stalenessMonths),
    // Provenance, not a verdict (ADR-007): the label tracks live suggestions
    // verbatim — deliberately not gated on "no real evidence", because a
    // listing with community celiac evidence can still carry live suggestions
    // on other attributes, and that provenance stays true. The suggestion
    // never feeds `safetyState`/`evidence`, so it can never overstate safety.
    suggestedByBot: suggested.length > 0,
    suggestedAttributes: suggested,
    // Confirmed non-headline claim badges — real community evidence, rendered
    // as the affirmed (non-suggested) ClaimBadge. Detail-page parity.
    confirmedAttributes: confirmed,
  };
}
