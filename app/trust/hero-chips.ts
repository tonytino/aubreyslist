import type { ClaimAttribute } from "~/listings/taxonomy";
import { hasEvidence, hasPositiveConsensus } from "~/trust/summary";

/**
 * The listing-detail hero's claim-chip row — the pure derivation behind the
 * badges under the headline verdict.
 *
 * Client-safe: pure logic over plain counts, no `db`/server-only imports.
 *
 * It answers one question the browse card answers with
 * `deriveListingTrustGlance`: which attributes earn a chip beside the headline
 * badge, and which of those are provenance rather than evidence. Keeping it
 * here, as its own testable seam, is what lets the two surfaces be pinned
 * against each other — a listing must not chip an attribute on its card and
 * omit it on its detail page.
 */

/** The per-claim inputs a chip decision needs: the counts plus bot provenance. */
export interface ClaimChipInput {
  attribute: ClaimAttribute;
  confirmCount: number;
  disputeCount: number;
  suggested: boolean;
}

/** One rendered chip: which attribute, and whether it is a bot suggestion. */
export interface ClaimChip {
  attribute: ClaimAttribute;
  /** True for the bot-provenance variant, false for confirmed evidence. */
  suggested: boolean;
}

/**
 * Derive the hero's chip row from a listing's full claim roll-up.
 *
 * Evidence before provenance, matching the browse card's chip order:
 *
 * 1. **Confirmed**, non-headline attributes with positive community consensus.
 *    The headline is excluded here unconditionally: `SafetySummary` IS its
 *    verdict, so a confirmed celiac chip beside that badge renders one claim
 *    twice.
 * 2. **Suggested**, any attribute — the headline included — carrying a live
 *    curator-bot suggestion (suggested, with zero votes). The headline earns a
 *    chip in exactly that state, because the hero renders nothing at all for a
 *    suggestion: without it, a seeded listing shows "Celiac-safe AI" on its
 *    browse card and nothing on its detail page.
 *
 * The first vote on a suggested claim clears its provenance, dropping the
 * headline back out of this row and handing it to the headline verdict. That
 * is what keeps ADR-016 intact here: a voted-but-contested celiac claim shows
 * NOTHING — no chip, no badge — exactly like an unattested one.
 *
 * The two groups are mutually exclusive by construction (consensus needs a
 * vote, a live suggestion needs none), so no attribute is ever chipped twice.
 * Input order is preserved within each group; the roll-up arrives in taxonomy
 * order, which puts the headline first among the suggestions.
 */
export function deriveHeroClaimChips(claims: readonly ClaimChipInput[]): ClaimChip[] {
  const confirmed = claims
    .filter((claim) => claim.attribute !== "celiac_safe" && hasPositiveConsensus(claim))
    .map((claim): ClaimChip => ({ attribute: claim.attribute, suggested: false }));

  const suggested = claims
    .filter((claim) => claim.suggested && !hasEvidence(claim))
    .map((claim): ClaimChip => ({ attribute: claim.attribute, suggested: true }));

  return [...confirmed, ...suggested];
}
