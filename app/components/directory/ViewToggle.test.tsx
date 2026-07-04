import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ViewToggle } from "./ViewToggle";

/**
 * Tests for the List/Map segmented control (AUB-61, Phase 2b). Accessible buttons
 * with `aria-pressed`; selecting a segment requests the new view.
 *
 * AUB-164: the Map segment is gated behind `mapEnabled` (defaults to `false`),
 * so most of these tests pass `mapEnabled` explicitly to exercise the Map
 * segment's own behavior; the default-hidden case is asserted separately below.
 */

describe("ViewToggle", () => {
  it("marks the active view via aria-pressed", () => {
    render(<ViewToggle view="list" onChange={() => {}} mapEnabled />);
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute("aria-pressed", "false");
  });

  it("requests 'map' when the Map segment is clicked", () => {
    const onChange = vi.fn();
    render(<ViewToggle view="list" onChange={onChange} mapEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(onChange).toHaveBeenCalledWith("map");
  });

  it("requests 'list' when the List segment is clicked", () => {
    const onChange = vi.fn();
    render(<ViewToggle view="map" onChange={onChange} mapEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(onChange).toHaveBeenCalledWith("list");
  });

  it("hides the Map segment by default (AUB-164, pending a real map in AUB-111)", () => {
    render(<ViewToggle view="list" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "List" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Map" })).not.toBeInTheDocument();
  });

  it("hides the Map segment when mapEnabled is explicitly false", () => {
    render(<ViewToggle view="list" onChange={() => {}} mapEnabled={false} />);
    expect(screen.queryByRole("button", { name: "Map" })).not.toBeInTheDocument();
  });
});
