import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DISTANCE_RADIUS_OPTIONS } from "~/listings/distance";
import { DistanceSelector } from "./DistanceSelector";

/**
 * Tests for the distance-radius selector (user feedback #7). An accessible,
 * controlled `<select>` reading "Within {value} mi of {originLabel}" that reports
 * the chosen radius (miles) back to the caller.
 */

describe("DistanceSelector", () => {
  it("renders the current value and origin label", () => {
    render(<DistanceSelector value={10} onChange={() => {}} originLabel="Union Station" />);

    // The labelled control reflects the selected radius…
    expect(screen.getByRole("combobox", { name: "Search radius" })).toHaveValue("10");
    // …and names the origin the radius is measured from.
    expect(screen.getByText("Union Station")).toBeInTheDocument();
  });

  it("uses the provided origin label (e.g. 'your location')", () => {
    render(<DistanceSelector value={25} onChange={() => {}} originLabel="your location" />);
    expect(screen.getByText("your location")).toBeInTheDocument();
  });

  it("offers every distance option", () => {
    render(<DistanceSelector value={25} onChange={() => {}} originLabel="Union Station" />);
    for (const miles of DISTANCE_RADIUS_OPTIONS) {
      expect(screen.getByRole("option", { name: `${miles} mi` })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("option")).toHaveLength(DISTANCE_RADIUS_OPTIONS.length);
  });

  it("calls onChange with the chosen miles as a number", () => {
    const onChange = vi.fn();
    render(<DistanceSelector value={25} onChange={onChange} originLabel="Union Station" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Search radius" }), {
      target: { value: "5" },
    });

    expect(onChange).toHaveBeenCalledWith(5);
  });
});
