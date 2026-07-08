import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FactOutcomeChip } from "~/components/add-listing/ReviewStep";
import { BADGE_FAMILY_SIZE } from "~/components/badge-size";
import { CLAIM_ATTRIBUTES, type ClaimAttribute } from "~/listings/taxonomy";
import { CLAIM_ATTRIBUTE_ICONS, claimAttributeLabel } from "~/trust/summary";
import { ClaimBadge } from "./ClaimBadge";

/**
 * PARITY GUARD (AUB-227) — the "means to maintain consistency" the issue asks for.
 *
 * The "confirmed/attested" concept is rendered by more than one chip: the
 * add-listing review `FactOutcomeChip` and the listing-detail `ClaimBadge`. Both
 * are supposed to draw their per-attribute ICON + attribute LABEL from the SINGLE
 * source in `~/trust/summary` and share the ONE badge family size
 * (`BADGE_FAMILY_SIZE`). This test FAILS if either surface drifts — e.g. someone
 * hard-codes a different glyph in the review step, or hand-tunes a chip's size —
 * so the two can't silently diverge again.
 *
 * It is intentionally NOT vacuous: it extracts the ACTUAL lucide glyph token that
 * each surface renders and the ACTUAL family-size tokens each applies, then
 * asserts they match the shared source. Swap one out and the assertion breaks.
 */

/** The four non-headline "fact" attributes (the headline uses a SafetySignal). */
const FACT_ATTRIBUTES = CLAIM_ATTRIBUTES.filter(
  (a): a is ClaimAttribute => a !== "celiac_safe_vs_gluten_friendly"
);

/** Extract the `lucide-<glyph>` token lucide stamps onto every icon's svg class. */
function lucideToken(svg: SVGElement | null): string {
  const cls = svg?.getAttribute("class") ?? "";
  return /lucide-[a-z-]+/.exec(cls)?.[0] ?? "";
}

/**
 * Family-size tokens every badge in the family must carry. Kept as a subset of
 * {@link BADGE_FAMILY_SIZE} that survives `tailwind-merge` untouched (no
 * conflicting utilities), so a chip that opts out of the shared constant — or
 * hand-tunes its own padding/radius/text — fails this guard.
 */
const FAMILY_TOKENS = ["rounded-chip", "px-2.5", "py-1", "text-body-sm", "font-medium"] as const;

// Sanity: the tokens we check are genuinely the shared constant's, so this guard
// tracks BADGE_FAMILY_SIZE rather than a stale hand-copied list.
for (const token of FAMILY_TOKENS) {
  if (!BADGE_FAMILY_SIZE.includes(token)) {
    throw new Error(`FAMILY_TOKENS drifted from BADGE_FAMILY_SIZE: ${token}`);
  }
}

describe("claim-chip parity (add-listing review ⇄ listing detail)", () => {
  it.each(
    FACT_ATTRIBUTES
  )("renders the SAME taxonomy icon for '%s' on both the ReviewStep chip and the detail ClaimBadge", (attribute) => {
    // The canonical glyph, taken straight from the shared source of truth.
    const Icon = CLAIM_ATTRIBUTE_ICONS[attribute];
    const canonical = render(<Icon aria-hidden="true" />);
    const canonicalToken = lucideToken(canonical.container.querySelector("svg"));
    expect(canonicalToken).toMatch(/^lucide-/);

    const detail = render(<ClaimBadge attribute={attribute} />);
    const detailBadge = detail.container.querySelector<HTMLElement>('[data-testid="claim-badge"]');
    expect(detailBadge).not.toBeNull();

    const review = render(<FactOutcomeChip attribute={attribute} confirmed />);
    const reviewChip = review.container.querySelector<HTMLElement>(
      '[data-testid="fact-confirmed"]'
    );
    expect(reviewChip).not.toBeNull();

    // Both surfaces render the exact same glyph the shared source dictates.
    const detailToken = lucideToken(detailBadge?.querySelector("svg") ?? null);
    const reviewToken = lucideToken(reviewChip?.querySelector("svg") ?? null);
    expect(detailToken).toBe(canonicalToken);
    expect(reviewToken).toBe(canonicalToken);
  });

  it.each(
    FACT_ATTRIBUTES
  )("applies the shared BADGE_FAMILY_SIZE tokens on both chips for '%s'", (attribute) => {
    const detail = render(<ClaimBadge attribute={attribute} />);
    const detailClass =
      detail.container.querySelector('[data-testid="claim-badge"]')?.getAttribute("class") ?? "";

    const review = render(<FactOutcomeChip attribute={attribute} confirmed />);
    const reviewClass =
      review.container.querySelector('[data-testid="fact-confirmed"]')?.getAttribute("class") ?? "";

    for (const token of FAMILY_TOKENS) {
      expect(detailClass).toContain(token);
      expect(reviewClass).toContain(token);
    }
  });

  it.each(
    FACT_ATTRIBUTES
  )("labels the detail ClaimBadge from the shared claimAttributeLabel for '%s'", (attribute) => {
    const label = claimAttributeLabel(attribute);
    const detail = render(<ClaimBadge attribute={attribute} />);
    expect(detail.container.querySelector('[data-testid="claim-badge"]')).toHaveTextContent(label);
  });

  it("keeps the confirmed and disputed fact chips distinguishable by icon + text, not colour alone", () => {
    const confirmed = render(<FactOutcomeChip attribute="dedicated_fryer" confirmed />);
    const disputed = render(<FactOutcomeChip attribute="dedicated_fryer" confirmed={false} />);

    // The outcome WORD is present and differs — meaning never rests on colour.
    expect(confirmed.container.querySelector('[data-testid="fact-confirmed"]')).toHaveTextContent(
      "Confirmed"
    );
    expect(disputed.container.querySelector('[data-testid="fact-disputed"]')).toHaveTextContent(
      "Disputed"
    );

    // Both carry an icon glyph (colour + icon + text), and the two tints differ.
    const confirmedChip = confirmed.container.querySelector<HTMLElement>(
      '[data-testid="fact-confirmed"]'
    );
    const disputedChip = disputed.container.querySelector<HTMLElement>(
      '[data-testid="fact-disputed"]'
    );
    expect(confirmedChip?.querySelector("svg")).not.toBeNull();
    expect(disputedChip?.querySelector("svg")).not.toBeNull();
    expect(confirmedChip?.getAttribute("class")).toContain("bg-brand-soft");
    expect(disputedChip?.getAttribute("class")).toContain("bg-muted");
    // Neither borrows the celiac-safe / gluten-friendly SAFETY colours — a plain
    // fact must never read as a safety verdict.
    expect(confirmedChip?.getAttribute("class")).not.toContain("celiac-safe");
    expect(disputedChip?.getAttribute("class")).not.toContain("gluten-friendly");
  });
});
