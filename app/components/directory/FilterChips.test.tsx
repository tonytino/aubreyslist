import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterChips } from "./FilterChips";

/**
 * Tests for the directory filter chip row (AUB-61, Phase 2b). The three quick
 * chips are real <button>s with `aria-pressed`, mutually exclusive, and toggle
 * off on a second click. The "Filters" chip is the entry point to the existing
 * server-side taxonomy filter (its sheet is Radix-portaled and only mounts on
 * open, so we assert on the trigger + its active-count badge here).
 */

function renderChips(overrides: Partial<Parameters<typeof FilterChips>[0]> = {}) {
  const onQuickChange = vi.fn();
  const onToggleAttr = vi.fn();
  const onClearAttrs = vi.fn();
  render(
    <FilterChips
      attrs={[]}
      onToggleAttr={onToggleAttr}
      onClearAttrs={onClearAttrs}
      quick={null}
      onQuickChange={onQuickChange}
      {...overrides}
    />
  );
  return { onQuickChange, onToggleAttr, onClearAttrs };
}

describe("FilterChips — quick chips", () => {
  it("renders the three quick chips plus the Filters trigger", () => {
    renderChips();
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Celiac-safe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gluten-friendly" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recently verified" })).toBeInTheDocument();
  });

  it("reflects the active quick chip via aria-pressed (state, not colour alone)", () => {
    renderChips({ quick: "celiac" });
    expect(screen.getByRole("button", { name: "Celiac-safe" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // Mutual exclusivity: the others are not pressed.
    expect(screen.getByRole("button", { name: "Gluten-friendly" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "Recently verified" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("selecting a chip requests that single quick value", () => {
    const { onQuickChange } = renderChips({ quick: null });
    fireEvent.click(screen.getByRole("button", { name: "Gluten-friendly" }));
    expect(onQuickChange).toHaveBeenCalledWith("friendly");
  });

  it("clicking the active chip toggles it back off (null)", () => {
    const { onQuickChange } = renderChips({ quick: "recent" });
    fireEvent.click(screen.getByRole("button", { name: "Recently verified" }));
    expect(onQuickChange).toHaveBeenCalledWith(null);
  });

  it("shows the active taxonomy-attribute count on the Filters chip", () => {
    renderChips({ attrs: ["dedicated_fryer", "celiac_safe_vs_gluten_friendly"] });
    const filters = screen.getByRole("button", { name: /Filters/ });
    expect(filters).toHaveTextContent("2");
  });
});
