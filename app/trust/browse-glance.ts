import type { SafetyState } from "~/components/SafetySignal";
import type { ClaimAggregate } from "~/server/attestations";
import { type Freshness, formatFreshness } from "~/trust/browse-card-format";
import { DEFAULT_STALENESS_MONTHS, deriveHeadlineSafetyState } from "~/trust/summary";

/**
 * Pure at-a-glance trust derivation for the browse list (issue #33).
 *
 * CLIENT-SAFE: this module is pure and imports NO database client — only the
 * client-safe pure derivations from `app/trust/summary.ts` and a type-only
 * reference to {@link ClaimAggregate}. It is therefore safe to import from the
 * browse-list cards (the client bundle) alongside `app/trust/summary.ts` and
 * `app/trust/incident-recency.ts`. Keep it free of any `db`/server-only imports.
 *
 * The browse card shows the SAME honest signals as the listing-detail page, just
 * condensed to a single glance:
 *
 * - **Headline safety state** — celiac-safe vs. gluten-friendly (or "may be
 *   stale"), derived from the `celiac_safe_vs_gluten_friendly` claim's VISIBLE
 *   aggregate via {@link deriveHeadlineSafetyState} (#29). `null` when there is
 *   no such claim or no evidence, so the card renders an honest "Not yet
 *   attested" rather than a fabricated verdict (a celiac could be hurt).
 * - **Recent-incident flag** — whether a recent "got glutened" report exists,
 *   computed server-side with #30's `findRecentIncident` recency helper and
 *   threaded in as the incident's instant. Recent harm flags the card regardless
 *   of older confirmations (ADR-007, domain.md → Trust Model).
 * - **Evidence counts** — the celiac claim's confirmations and the number of
 *   distinct contributors (AUB-61 redesign), a plain count of the visible
 *   attestation rows the user can also see.
 * - **Freshness cue** — a compact `{ kind, label }` recency descriptor derived
 *   purely by `formatFreshness` (incident → fresh → stale precedence).
 *
 * This is a roll-up of visible evidence, never a secret score — the same reading
 * any user gets from the listing-detail page.
 */

/** Community evidence counts a browse card surfaces beside the safety verdict. */
export interface ListingEvidence {
  /** Confirmations on the celiac claim (its `confirmCount`). */
  confirmations: number;
  /** Distinct people who attested (confirmed OR disputed) the celiac claim. */
  contributors: number;
}

/** The minimal, render-ready trust glance one browse card needs. */
export interface ListingTrustGlance {
  /**
   * The headline celiac-safe vs. gluten-friendly (or stale) state, or `null`
   * when there is no celiac claim / no attestation evidence. `null` drives the
   * card's honest "Not yet attested" empty state — never a fabricated verdict.
   */
  safetyState: SafetyState | null;
  /** Whether a RECENT "got glutened" incident flags this listing. */
  hasRecentIncident: boolean;
  /**
   * Community evidence counts (celiac-claim confirmations + distinct
   * contributors), or `null` when the listing has no celiac claim / no evidence.
   */
  evidence: ListingEvidence | null;
  /**
   * The render-ready freshness cue (`{ kind, label }`), or `null` when there is
   * nothing honest to show (no incident and no confirmation timestamp).
   */
  freshness: Freshness | null;
}

/**
 * Derive a listing's at-a-glance trust from its `celiac_safe_vs_gluten_friendly`
 * aggregate (or `null`/`undefined` when the listing has no such claim), a
 * distinct-contributor count, and the most recent in-window incident's instant.
 *
 * The aggregate is optional because not every listing has a celiac claim row;
 * passing `null`/`undefined` yields a `null` `safetyState` (the honest empty
 * state) and `null` `evidence`, exactly as a claim with no evidence would.
 *
 * `recentIncidentAt` is the most recent in-window incident's instant (or `null`);
 * `hasRecentIncident` is derived from it so the two can never disagree, and the
 * freshness cue phrases the incident from its own recency.
 */
export function deriveListingTrustGlance(
  celiacAggregate:
    | Pick<ClaimAggregate, "confirmCount" | "disputeCount" | "lastConfirmedAt">
    | null
    | undefined,
  contributors: number,
  recentIncidentAt: Date | null,
  now: Date = new Date(),
  stalenessMonths: number = DEFAULT_STALENESS_MONTHS
): ListingTrustGlance {
  const lastConfirmedAt = celiacAggregate?.lastConfirmedAt ?? null;
  const hasEvidence =
    celiacAggregate !== null &&
    celiacAggregate !== undefined &&
    celiacAggregate.confirmCount + celiacAggregate.disputeCount > 0;

  return {
    safetyState: celiacAggregate
      ? deriveHeadlineSafetyState(celiacAggregate, now, stalenessMonths)
      : null,
    hasRecentIncident: recentIncidentAt !== null,
    // Only surface counts when there is real evidence — a claim row with zero
    // votes (or no claim at all) shows the honest "Not yet attested" empty state,
    // never "0 confirmations".
    evidence: hasEvidence ? { confirmations: celiacAggregate.confirmCount, contributors } : null,
    freshness: formatFreshness(lastConfirmedAt, recentIncidentAt, now, stalenessMonths),
  };
}
