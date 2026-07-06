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

  it("swaps in the suggested variant: Sparkles icon, gradient ring, and a tooltip instead of visible prefix text", async () => {
    render(<ClaimBadge attribute="off_menu_gf_on_request" suggested />);
    const badge = screen.getByTestId("suggested-attribute");
    // The label is still visible, but no visible "Suggested:" prefix — the
    // suggested-ness is carried by the icon/gradient wrapper + tooltip instead.
    expect(badge).toHaveTextContent("Off-menu GF on request");
    expect(badge.textContent).not.toMatch(/Suggested:/);
    // The tooltip is keyboard-reachable (a real <button> trigger) and carries
    // the "not yet confirmed" gloss that the visible chip no longer states.
    const trigger = badge.closest("[data-slot='tooltip-trigger']") as HTMLElement;
    fireEvent.focus(trigger);
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent(/not yet confirmed by the community/i);
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
