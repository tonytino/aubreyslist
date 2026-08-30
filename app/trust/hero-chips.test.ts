import { describe, expect, it } from "vitest";
import { CLAIM_ATTRIBUTES, type ClaimAttribute } from "~/listings/taxonomy";
import { deriveListingTrustGlance } from "~/trust/browse-glance";
import { type ClaimChipInput, deriveHeroClaimChips } from "~/trust/hero-chips";

/**
 * Tests for the listing-detail hero's claim-chip row.
 *
 * Two guarantees live here, and they pull in opposite directions:
 *
 * - A suggestion-only headline claim MUST chip, because the hero renders
 *   nothing for a suggestion and the browse card renders "Celiac-safe AI". One
 *   surface showing a chip the other omits is the inconsistency this exists to
 *   close.
 * - A headline claim with ANY vote must NOT chip, whatever the votes say. A
 *   confirmed one is already the hero badge (chipping it renders one claim
 *   twice); a contested one shows nothing anywhere, by ADR-016.
 */

/** A claim entry as the listing roll-up hands it over. */
function claim(
  attribute: ClaimAttribute,
  overrides: Partial<Omit<ClaimChipInput, "attribute">> = {}
): ClaimChipInput {
  return { attribute, confirmCount: 0, disputeCount: 0, suggested: false, ...overrides };
}

/** `[confirmCount, disputeCount]` pairs, tupled so the loop destructures cleanly. */
type VoteCase = [number, number];

/** The full fixed taxonomy in canonical order, as the roll-up returns it. */
function taxonomy(overrides: Partial<Record<ClaimAttribute, Partial<ClaimChipInput>>> = {}) {
  return CLAIM_ATTRIBUTES.map((attribute) => claim(attribute, overrides[attribute] ?? {}));
}

describe("deriveHeroClaimChips — the suggestion-only headline", () => {
  it("chips a suggestion-only headline claim, so the hero is not blank where the card badges", () => {
    const chips = deriveHeroClaimChips(taxonomy({ celiac_safe: { suggested: true } }));

    expect(chips).toEqual([{ attribute: "celiac_safe", suggested: true }]);
  });

  it("leads the SUGGESTED set with the headline, matching the card's chip order", () => {
    const chips = deriveHeroClaimChips(
      taxonomy({
        celiac_safe: { suggested: true },
        gf_substitutes: { suggested: true },
        // Real evidence on a third attribute, so both groups are populated.
        dedicated_fryer: { confirmCount: 4, disputeCount: 1 },
      })
    );

    // Evidence first, then provenance with the headline at its head.
    expect(chips).toEqual([
      { attribute: "dedicated_fryer", suggested: false },
      { attribute: "celiac_safe", suggested: true },
      { attribute: "gf_substitutes", suggested: true },
    ]);
  });
});

describe("deriveHeroClaimChips — a voted headline never chips", () => {
  it("drops the headline the moment it has ANY vote, even one that keeps the suggestion flag", () => {
    // `suggested` may still read true on a stale snapshot between the vote
    // write and its provenance clear. The zero-vote gate is what stops that
    // window from chipping a claim the community has already touched.
    const votedCases: VoteCase[] = [
      [1, 0],
      [0, 1],
      [8, 1],
      [1, 8],
      [4, 4],
    ];
    for (const [confirmCount, disputeCount] of votedCases) {
      const chips = deriveHeroClaimChips(
        taxonomy({
          celiac_safe: { suggested: true, confirmCount, disputeCount },
        })
      );
      expect(chips, `${confirmCount}c/${disputeCount}d`).toEqual([]);
    }
  });

  it("never chips a CONFIRMED headline — the hero badge already renders that verdict", () => {
    // Double-rendering the same claim (badge + chip) is the failure the
    // headline exclusion exists to prevent.
    const chips = deriveHeroClaimChips(
      taxonomy({ celiac_safe: { confirmCount: 9, disputeCount: 0 } })
    );
    expect(chips).toEqual([]);
  });

  it("never chips a CONTESTED headline — it shows nothing anywhere (ADR-016)", () => {
    const contestedCases: VoteCase[] = [
      [2, 5],
      [4, 4],
      [0, 3],
    ];
    for (const [confirmCount, disputeCount] of contestedCases) {
      const chips = deriveHeroClaimChips(taxonomy({ celiac_safe: { confirmCount, disputeCount } }));
      expect(chips, `${confirmCount}c/${disputeCount}d`).toEqual([]);
    }
  });

  it("chips nothing at all for a wholly unattested listing", () => {
    expect(deriveHeroClaimChips(taxonomy())).toEqual([]);
  });
});

describe("deriveHeroClaimChips — non-headline attributes are unchanged", () => {
  it("chips a confirmed non-headline attribute as evidence, not provenance", () => {
    const chips = deriveHeroClaimChips(
      taxonomy({ off_menu_gf_on_request: { confirmCount: 3, disputeCount: 1 } })
    );
    expect(chips).toEqual([{ attribute: "off_menu_gf_on_request", suggested: false }]);
  });

  it("withholds a contested non-headline attribute (a tie is not an affirmation)", () => {
    const chips = deriveHeroClaimChips(
      taxonomy({ dedicated_gf_menu: { confirmCount: 3, disputeCount: 3 } })
    );
    expect(chips).toEqual([]);
  });

  it("never chips one attribute twice — the two groups cannot overlap", () => {
    const chips = deriveHeroClaimChips(
      taxonomy({
        dedicated_fryer: { suggested: true, confirmCount: 5, disputeCount: 0 },
      })
    );
    const attributes = chips.map((chip) => chip.attribute);
    expect(new Set(attributes).size).toBe(attributes.length);
    // A voted claim is evidence, never a live suggestion.
    expect(chips).toEqual([{ attribute: "dedicated_fryer", suggested: false }]);
  });
});

describe("card ↔ detail parity for the suggested chips", () => {
  it("shows the SAME suggested attributes on both surfaces, headline included", () => {
    // The bug this closes: the card folded a suggestion-only headline into its
    // suggested set while the detail page filtered the headline out
    // unconditionally, so one surface showed "Celiac-safe AI" and the other
    // showed nothing. Pinned as an equality between the two derivations.
    const claims = taxonomy({
      celiac_safe: { suggested: true },
      gf_substitutes: { suggested: true },
    });

    const cardSuggested = deriveListingTrustGlance(
      { confirmCount: 0, disputeCount: 0, lastConfirmedAt: null, suggested: true },
      0,
      null,
      new Date(),
      undefined,
      ["celiac_safe", "gf_substitutes"]
    ).suggestedAttributes;

    const detailSuggested = deriveHeroClaimChips(claims)
      .filter((chip) => chip.suggested)
      .map((chip) => chip.attribute);

    // Both non-empty and equal — an equality between two empty lists would
    // pass while the bug was still live.
    expect(cardSuggested).toEqual(["celiac_safe", "gf_substitutes"]);
    expect(detailSuggested).toEqual(cardSuggested);
  });

  it("agrees on withholding once the headline claim has a vote", () => {
    // The converse: a voted headline leaves BOTH surfaces with no suggestion.
    const voted = {
      confirmCount: 3,
      disputeCount: 0,
      lastConfirmedAt: new Date(),
      suggested: true,
    };

    const cardSuggested = deriveListingTrustGlance(voted, 3, null, new Date()).suggestedAttributes;
    const detailSuggested = deriveHeroClaimChips(
      taxonomy({ celiac_safe: { suggested: true, confirmCount: 3, disputeCount: 0 } })
    ).filter((chip) => chip.suggested);

    expect(cardSuggested).toEqual([]);
    expect(detailSuggested).toEqual([]);
  });
});
