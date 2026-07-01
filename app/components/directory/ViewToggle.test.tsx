import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ViewToggle } from "./ViewToggle";

/**
 * Tests for the List/Map segmented control (AUB-61, Phase 2b). Accessible buttons
 * with `aria-pressed`; selecting a segment requests the new view.
 */

describe("ViewToggle", () => {
  it("marks the active view via aria-pressed", () => {
    render(<ViewToggle view="list" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute("aria-pressed", "false");
  });

  it("requests 'map' when the Map segment is clicked", () => {
    const onChange = vi.fn();
    render(<ViewToggle view="list" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(onChange).toHaveBeenCalledWith("map");
  });

  it("requests 'list' when the List segment is clicked", () => {
    const onChange = vi.fn();
    render(<ViewToggle view="map" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(onChange).toHaveBeenCalledWith("list");
  });
});
