import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClaimBadge } from "./ClaimBadge";

describe("ClaimBadge", () => {
  it("renders the attribute's label with its own taxonomy icon by default", () => {
    render(<ClaimBadge attribute="off_menu_gf_on_request" />);
    const badge = screen.getByTestId("claim-badge");
    expect(badge).toHaveTextContent("Off-menu GF on request");
  });

  it("renders every taxonomy attribute — the missing off-menu-GF badge is fixed", () => {
    render(<ClaimBadge attribute="dedicated_fryer" />);
    expect(screen.getByText("Dedicated fryer")).toBeInTheDocument();
  });

  it("renders the suggested variant with the attribute's OWN icon, gradient ring, an always-visible AI marker AFTER the label, and a supplementary tooltip", async () => {
    render(<ClaimBadge attribute="off_menu_gf_on_request" suggested />);
    const badge = screen.getByTestId("suggested-attribute");
    expect(badge).toHaveTextContent("Off-menu GF on request");
    // The suggested variant keeps the attribute's own glyph, never a generic
    // Sparkles icon. lucide stamps the glyph name onto the svg's class
    // (`lucide-concierge-bell` for ConciergeBell), so assert that specific icon
    // and, explicitly, not Sparkles.
    const iconClass = badge.querySelector("svg")?.getAttribute("class") ?? "";
    expect(iconClass).toContain("lucide-concierge-bell");
    expect(iconClass).not.toContain("lucide-sparkles");
    // The "AI" tag is real, always-painted text — not hover/focus-gated — so it
    // renders even without any interaction (the touch-accessible path).
    const aiTrigger = screen.getByRole("button", { name: "AI" });
    expect(aiTrigger).toBeInTheDocument();
    // Render order is `[attribute icon] [label] [AI marker]`.
    expect(badge.textContent).toMatch(/Off-menu GF on request.*AI/s);
    expect(badge.textContent?.trimStart().startsWith("AI")).toBe(false);
    // The tooltip is a supplementary channel, reachable via the "AI" button's own
    // focus, carrying the fuller "not yet confirmed" gloss.
    fireEvent.focus(aiTrigger);
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent(/not yet confirmed by the community/i);
  });

  it("shows the AI tag on render alone, with no interaction — the touch-accessible path, since Radix's tooltip never opens on touch", () => {
    render(<ClaimBadge attribute="dedicated_fryer" suggested />);
    // No focus/hover/click fired at all: a touch tap that never opens the
    // tooltip still leaves this visible on the page.
    expect(screen.getByRole("button", { name: "AI" })).toBeVisible();
  });

  it("keeps the 'AI' trigger's accessible name label-free, so it can never share an accessible name+role with a same-label real control elsewhere on the page (e.g. a browse filter chip) — Playwright's getByRole name matching is substring-based, so a text prefix/suffix on the attribute label could never disambiguate; only a label-free trigger name actually prevents the collision", () => {
    render(<ClaimBadge attribute="dedicated_fryer" suggested />);
    // No button on this badge is named after the attribute label at all.
    expect(screen.queryByRole("button", { name: /dedicated fryer/i })).not.toBeInTheDocument();
    // The only button is the "AI" trigger, a real natively-focusable element.
    expect(screen.getByRole("button", { name: "AI" })).toBeInTheDocument();
  });

  it("keeps the confirmed and suggested variants structurally distinct via data-testid", () => {
    const { rerender } = render(<ClaimBadge attribute="gf_substitutes" />);
    expect(screen.getByTestId("claim-badge")).toBeInTheDocument();
    expect(screen.queryByTestId("suggested-attribute")).not.toBeInTheDocument();

    rerender(<ClaimBadge attribute="gf_substitutes" suggested />);
    expect(screen.queryByTestId("claim-badge")).not.toBeInTheDocument();
    expect(screen.getByTestId("suggested-attribute")).toBeInTheDocument();
  });
});
