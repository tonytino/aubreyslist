import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DISTANCE_RADIUS_OPTIONS } from "~/listings/distance";
import { DistanceSelector } from "./DistanceSelector";

/**
 * Tests for the distance-radius selector. A single accessible `<select>`
 * styled as a chip, reading "Within {value} miles" — the origin is not shown —
 * that reports the chosen radius (miles) back to the caller.
 */

describe("DistanceSelector", () => {
  it("reflects the selected radius", () => {
    render(<DistanceSelector value={10} onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Search radius" })).toHaveValue("10");
  });

  it("labels each option 'Within N miles' and shows no origin", () => {
    render(<DistanceSelector value={25} onChange={() => {}} />);
    for (const miles of DISTANCE_RADIUS_OPTIONS) {
      expect(screen.getByRole("option", { name: `Within ${miles} miles` })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("option")).toHaveLength(DISTANCE_RADIUS_OPTIONS.length);
    // The origin (e.g. "Union Station" / "your location") is deliberately hidden.
    expect(screen.queryByText(/Union Station|your location/)).not.toBeInTheDocument();
  });

  it("calls onChange with the chosen miles as a number", () => {
    const onChange = vi.fn();
    render(<DistanceSelector value={25} onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Search radius" }), {
      target: { value: "5" },
    });

    expect(onChange).toHaveBeenCalledWith(5);
  });
});
