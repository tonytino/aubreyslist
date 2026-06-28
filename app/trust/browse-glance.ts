import type { SafetyState } from "~/components/SafetySignal";
import type { ClaimAggregate } from "~/server/attestations";
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
 *   threaded in as a boolean. Recent harm flags the card regardless of older
 *   confirmations (ADR-007, domain.md → Trust Model).
 *
 * This is a roll-up of visible evidence, never a secret score — the same reading
 * any user gets from the listing-detail page.
 */

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
}

/**
 * Derive a listing's at-a-glance trust from its `celiac_safe_vs_gluten_friendly`
 * aggregate (or `null`/`undefined` when the listing has no such claim) and a
 * precomputed recent-incident flag.
 *
 * The aggregate is optional because not every listing has a celiac claim row;
 * passing `null`/`undefined` yields a `null` `safetyState` (the honest empty
 * state), exactly as a claim with no evidence would.
 */
export function deriveListingTrustGlance(
  celiacAggregate:
    | Pick<ClaimAggregate, "confirmCount" | "disputeCount" | "lastConfirmedAt">
    | null
    | undefined,
  hasRecentIncident: boolean,
  now: Date = new Date(),
  stalenessMonths: number = DEFAULT_STALENESS_MONTHS
): ListingTrustGlance {
  return {
    safetyState: celiacAggregate
      ? deriveHeadlineSafetyState(celiacAggregate, now, stalenessMonths)
      : null,
    hasRecentIncident,
  };
}
