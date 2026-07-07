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
    expect(badge).toHaveTextContent("Off-menu GF on request");
    // The tooltip is keyboard-reachable (a real <button> trigger) and carries
    // the "not yet confirmed" gloss that the visible chip no longer states.
    const trigger = badge.closest("[data-slot='tooltip-trigger']") as HTMLElement;
    fireEvent.focus(trigger);
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent(/not yet confirmed by the community/i);
  });

  it("carries a sr-only 'Suggested: ' prefix in its accessible name (not visible text) so it never shares an accessible name with a same-label real control (e.g. a browse filter chip)", () => {
    render(<ClaimBadge attribute="dedicated_fryer" suggested />);
    // The accessible name (what a screen reader announces, and what Playwright's
    // getByRole name-matching uses) is prefix-qualified...
    expect(
      screen.getByRole("button", { name: /suggested:\s*dedicated fryer/i })
    ).toBeInTheDocument();
    // ...but the prefix itself is visually hidden (sr-only), never painted.
    const srPrefix = screen.getByText("Suggested:", { exact: false });
    expect(srPrefix).toHaveClass("sr-only");
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
