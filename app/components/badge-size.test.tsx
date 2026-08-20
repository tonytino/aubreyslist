import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClaimBadge } from "~/components/listing/ClaimBadge";
import { SafetySignal } from "~/components/SafetySignal";

/**
 * Regression guard: the whole badge family must resolve to the same rendered
 * size — same font-size utility, same border-radius utility — even though the
 * two components compose different primitives. Class-level assertions on
 * purpose: the shared {@link BADGE_FAMILY_SIZE} string only unifies the size
 * once `cn` (tailwind-merge) knows the custom `--text-*` / `--radius-*` tokens
 * (see `app/lib/utils.ts`). Without that, tailwind-merge mis-groups
 * `text-body-sm` as a text-colour and drops it, and the two badges silently
 * render at different sizes with a green test suite.
 */

// The custom font-size + radius utilities defined under `@theme` in
// `app/styles/app.css`, plus the stock ones a shadcn primitive might fall back
// to — so the helpers below can spot a regression to the wrong size/shape.
const FONT_SIZE_CLASSES = [
  "text-caption",
  "text-body-sm",
  "text-body",
  "text-lead",
  "text-title",
  "text-card-title",
  "text-headline",
  "text-display",
  "text-xs",
  "text-sm",
  "text-base",
  "text-lg",
];
const RADIUS_CLASSES = [
  "rounded-chip",
  "rounded-card",
  "rounded-none",
  "rounded-sm",
  "rounded",
  "rounded-md",
  "rounded-lg",
  "rounded-xl",
  "rounded-full",
];

function pick(el: HTMLElement, candidates: string[]): string[] {
  const classes = el.className.split(/\s+/);
  return candidates.filter((c) => classes.includes(c));
}

describe("badge family shared size (AUB-224)", () => {
  it("resolves the headline SafetySignal and the per-claim ClaimBadge to the SAME single font-size utility", () => {
    const { unmount } = render(<SafetySignal state="celiac-safe" variant="solid" />);
    const safetyFonts = pick(
      document.querySelector("[data-safety-state]") as HTMLElement,
      FONT_SIZE_CLASSES
    );
    unmount();

    render(<ClaimBadge attribute="off_menu_gf_on_request" />);
    const claimFonts = pick(screen.getByTestId("claim-badge"), FONT_SIZE_CLASSES);

    // Exactly one font-size class each (a leftover primitive size would make 2)...
    expect(safetyFonts).toEqual(["text-body-sm"]);
    // ...and no fallback to the Badge primitive's base `text-xs`.
    expect(claimFonts).toEqual(["text-body-sm"]);
    expect(safetyFonts).toEqual(claimFonts);
  });

  it("resolves both to the SAME single border-radius utility, with no leftover primitive radius", () => {
    const { unmount } = render(<SafetySignal state="celiac-safe" variant="solid" />);
    const safetyRadii = pick(
      document.querySelector("[data-safety-state]") as HTMLElement,
      RADIUS_CLASSES
    );
    unmount();

    render(<ClaimBadge attribute="off_menu_gf_on_request" />);
    const claimRadii = pick(screen.getByTestId("claim-badge"), RADIUS_CLASSES);

    expect(safetyRadii).toEqual(["rounded-chip"]);
    // The Badge primitive ships `rounded-md`; it must be stripped, not doubled up.
    expect(claimRadii).toEqual(["rounded-chip"]);
    expect(safetyRadii).toEqual(claimRadii);
  });

  it("keeps the same shared size on the suggested ClaimBadge variant too", () => {
    render(<ClaimBadge attribute="dedicated_fryer" suggested />);
    const badge = screen.getByTestId("suggested-attribute");
    expect(pick(badge, FONT_SIZE_CLASSES)).toEqual(["text-body-sm"]);
    expect(pick(badge, RADIUS_CLASSES)).toEqual(["rounded-chip"]);
  });
});
