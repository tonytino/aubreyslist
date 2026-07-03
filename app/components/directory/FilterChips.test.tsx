import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterChips } from "./FilterChips";

/**
 * Tests for the directory filter chip row (AUB-61, Phase 2b; faceted in AUB-140).
 * The quick chips are real <button>s with `aria-pressed`; the component is purely
 * presentational — it renders whichever set it's handed and reports each click via
 * `onQuickToggle` (the group-exclusivity rule lives in the parent's `applyQuickToggle`
 * reducer, unit-tested in quick.test.ts). The "Filters" chip is the entry point to
 * the existing server-side taxonomy filter (its sheet is Radix-portaled and only
 * mounts on open, so we assert on the trigger + its active-count badge here). The
 * search leads the row as a {@link SearchChip} (user feedback #5).
 */

function renderChips(overrides: Partial<Parameters<typeof FilterChips>[0]> = {}) {
  const onQuickToggle = vi.fn();
  const onToggleAttr = vi.fn();
  const onClearAttrs = vi.fn();
  const onSearchChange = vi.fn();
  render(
    <FilterChips
      attrs={[]}
      onToggleAttr={onToggleAttr}
      onClearAttrs={onClearAttrs}
      quick={[]}
      onQuickToggle={onQuickToggle}
      search=""
      onSearchChange={onSearchChange}
      {...overrides}
    />
  );
  return { onQuickToggle, onToggleAttr, onClearAttrs, onSearchChange };
}

describe("FilterChips — quick chips", () => {
  it("renders the three quick chips plus the Filters trigger", () => {
    renderChips();
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Celiac-safe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gluten-friendly" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recently verified" })).toBeInTheDocument();
  });

  it("reflects the active quick set via aria-pressed (state, not colour alone)", () => {
    renderChips({ quick: ["celiac"] });
    expect(screen.getByRole("button", { name: "Celiac-safe" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Gluten-friendly" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "Recently verified" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("renders an additive combination (safety + recency) as multiple pressed chips", () => {
    // The faceted model allows a safety choice AND recently-verified at once — both
    // read as pressed, while the unselected safety sibling stays off.
    renderChips({ quick: ["celiac", "recent"] });
    expect(screen.getByRole("button", { name: "Celiac-safe" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Recently verified" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Gluten-friendly" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("clicking a chip reports its value (the parent reducer computes the next set)", () => {
    const { onQuickToggle } = renderChips({ quick: [] });
    fireEvent.click(screen.getByRole("button", { name: "Gluten-friendly" }));
    expect(onQuickToggle).toHaveBeenCalledWith("friendly");
  });

  it("clicking an already-active chip still reports its value (toggle-off is the parent's job)", () => {
    const { onQuickToggle } = renderChips({ quick: ["recent"] });
    fireEvent.click(screen.getByRole("button", { name: "Recently verified" }));
    expect(onQuickToggle).toHaveBeenCalledWith("recent");
  });

  it("shows the active taxonomy-attribute count on the Filters chip", () => {
    renderChips({ attrs: ["dedicated_fryer", "celiac_safe_vs_gluten_friendly"] });
    const filters = screen.getByRole("button", { name: /Filters/ });
    expect(filters).toHaveTextContent("2");
  });
});

describe("FilterChips — search chip (user feedback #5)", () => {
  it("renders the search chip as the first control in the row", () => {
    renderChips();
    const search = screen.getByRole("button", { name: "Search restaurants" });
    expect(search).toBeInTheDocument();
    // The collapsed search chip leads the row, before the Filters trigger.
    const filters = screen.getByRole("button", { name: "Filters" });
    expect(search.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reflects an applied search value as the active chip", () => {
    renderChips({ search: "rooted" });
    expect(screen.getByRole("button", { name: "Search: rooted" })).toBeInTheDocument();
  });

  it("threads search edits through onSearchChange", () => {
    const { onSearchChange } = renderChips();
    fireEvent.click(screen.getByRole("button", { name: "Search restaurants" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "root" } });
    expect(onSearchChange).toHaveBeenCalledWith("root");
  });
});
