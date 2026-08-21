import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BROWSE_SORT_OPTIONS } from "~/listings/sort";
import { SortSelector } from "./SortSelector";

/**
 * Tests for the sort selector chip. A single accessible `<select>` styled as a
 * chip — mirroring DistanceSelector — that surfaces the server-side `?sort=`
 * control in the filter chip row.
 */

describe("SortSelector", () => {
  it("reflects the active sort", () => {
    render(<SortSelector value="trust" onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("trust");
  });

  it("offers every registered browse sort, in registry order", () => {
    render(<SortSelector value="alpha" onChange={() => {}} />);
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(
      BROWSE_SORT_OPTIONS.map((option) => option.label)
    );
  });

  it("calls onChange with the chosen sort token", () => {
    const onChange = vi.fn();
    render(<SortSelector value="alpha" onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), {
      target: { value: "distance" },
    });

    expect(onChange).toHaveBeenCalledWith("distance");
  });

  it("sizes the chip to the selected option, not the longest one", () => {
    // A native <select> is as wide as its widest <option>, so "Near me" would
    // otherwise sit in a chip sized for "Alphabetical (A–Z)". An invisible
    // sizer carries the selected label and sets the width.
    const { container, rerender } = render(<SortSelector value="distance" onChange={() => {}} />);

    const sizer = container.querySelector("span[aria-hidden='true']");
    expect(sizer).not.toBeNull();
    expect(sizer?.textContent).toBe("Near me");
    // Hidden from assistive tech (the <select> already announces the value)
    // but still occupying its grid cell, which is the entire point.
    expect(sizer?.className).toContain("invisible");
    expect(sizer?.className).not.toContain("hidden");

    rerender(<SortSelector value="alpha" onChange={() => {}} />);
    expect(container.querySelector("span[aria-hidden='true']")?.textContent).toBe(
      "Alphabetical (A–Z)"
    );
  });

  it("keeps the sizer out of the accessible name and option list", () => {
    render(<SortSelector value="distance" onChange={() => {}} />);

    // One combobox, one set of options: the sizer duplicates the label text in
    // the DOM and must never read as a second control or a stray option.
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getAllByRole("option")).toHaveLength(BROWSE_SORT_OPTIONS.length);
  });
});
