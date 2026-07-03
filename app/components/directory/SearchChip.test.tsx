import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchChip } from "./SearchChip";

/**
 * Tests for the search-as-chip control (user feedback #5). The chip collapses/
 * expands and, when a query is applied, reads as the active (brand) filter chip
 * carrying the query text + a clear affordance.
 */

describe("SearchChip", () => {
  it("renders a collapsed, ICON-ONLY chip when empty (repo-owner mobile feedback)", () => {
    render(<SearchChip value="" onChange={() => {}} />);
    const chip = screen.getByRole("button", { name: "Search restaurants" });
    // The accessible name comes entirely from aria-label — no visible label text.
    expect(chip).toHaveTextContent("");
    expect(chip).toHaveAttribute("aria-expanded", "false");
    // No text input while collapsed.
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("expands to a search input when the collapsed chip is clicked", () => {
    render(<SearchChip value="" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Search restaurants" }));
    const input = screen.getByRole("searchbox", { name: "Search restaurants" });
    expect(input).toHaveAttribute("placeholder", "Search restaurants");
  });

  it("focuses the input synchronously on click (iOS double-tap fix)", () => {
    // Regression test for the iOS Safari double-tap bug: focus must land inside
    // the SAME synchronous click handler, not a deferred `requestAnimationFrame`
    // callback. jsdom never fires a real rAF during a synchronous `fireEvent`, so
    // this only passes if `expand()` focuses synchronously (via `flushSync`).
    render(<SearchChip value="" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Search restaurants" }));
    expect(screen.getByRole("searchbox", { name: "Search restaurants" })).toHaveFocus();
  });

  it("reports each keystroke to onChange while expanded", () => {
    const onChange = vi.fn();
    render(<SearchChip value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Search restaurants" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "root" } });
    expect(onChange).toHaveBeenCalledWith("root");
  });

  it("shows the query in the applied chip when collapsed with a value", () => {
    render(<SearchChip value="rooted" onChange={() => {}} />);
    // Collapsed by default even with a value: the applied chip, not an input.
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    const chipBody = screen.getByRole("button", { name: "Search: rooted" });
    expect(chipBody).toHaveTextContent("rooted");
    // The applied chip uses the active/brand fill (on the chip container that
    // wraps the body + clear buttons).
    expect(chipBody.parentElement).toHaveClass("bg-brand");
    // An explicit clear affordance is present in the applied state.
    expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();
  });

  it("clears the query from the applied chip without expanding", () => {
    const onChange = vi.fn();
    render(<SearchChip value="rooted" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenCalledWith("");
    // Clearing must not have expanded the control.
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("clears from within the expanded input", () => {
    const onChange = vi.fn();
    render(<SearchChip value="rooted" onChange={onChange} />);
    // Expand via the applied chip, then use the inline clear.
    fireEvent.click(screen.getByRole("button", { name: "Search: rooted" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("collapses back to a chip on blur, keeping the query", () => {
    render(<SearchChip value="rooted" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Search: rooted" }));
    fireEvent.blur(screen.getByRole("searchbox"));
    // Back to the applied chip (query preserved), no input.
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search: rooted" })).toBeInTheDocument();
  });
});
