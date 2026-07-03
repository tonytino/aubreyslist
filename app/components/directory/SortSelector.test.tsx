import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BROWSE_SORT_OPTIONS } from "~/listings/sort";
import { SortSelector } from "./SortSelector";

/**
 * Tests for the sort selector chip (AUB-198). A single accessible `<select>`
 * styled as a chip — mirroring DistanceSelector — that surfaces the server-side
 * `?sort=` control in the filter chip row now that the Filters sheet is retired.
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
});
