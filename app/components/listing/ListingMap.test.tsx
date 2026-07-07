import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListingMap } from "./ListingMap";

/**
 * Tests for the embedded per-restaurant map (AUB-216, ADR-014). Each test
 * pins `VITE_GOOGLE_MAPS_BROWSER_KEY` explicitly via `vi.stubEnv` (same
 * pattern as `DirectoryMap.test.tsx`) so results are deterministic regardless
 * of whether the machine running the suite has a real key in `.env`.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ListingMap", () => {
  it("renders nothing when the browser key is absent", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_BROWSER_KEY", "");
    const { container } = render(
      <ListingMap name="Root & Rye" address="123 Main St, Denver, CO" placeId="place-abc" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders an iframe with a place_id query when the listing has a Places id", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_BROWSER_KEY", "test-key");
    render(<ListingMap name="Root & Rye" address="123 Main St, Denver, CO" placeId="ChIJ123abc" />);
    const iframe = screen.getByTitle("Map of Root & Rye");
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe).toHaveAttribute(
      "src",
      "https://www.google.com/maps/embed/v1/place?key=test-key&q=place_id:ChIJ123abc"
    );
    expect(iframe).toHaveAttribute("loading", "lazy");
    expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer-when-downgrade");
    expect(iframe).toHaveAttribute("allowfullscreen");
  });

  it("falls back to a name + address query for a manual listing (no place_id)", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_BROWSER_KEY", "test-key");
    render(<ListingMap name="Home Kitchen" address="1 Oak Ave, Boulder, CO" placeId={null} />);
    const iframe = screen.getByTitle("Map of Home Kitchen");
    const expectedQuery = encodeURIComponent("Home Kitchen, 1 Oak Ave, Boulder, CO");
    expect(iframe).toHaveAttribute(
      "src",
      `https://www.google.com/maps/embed/v1/place?key=test-key&q=${expectedQuery}`
    );
  });

  it("encodes special characters in the manual-listing query", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_BROWSER_KEY", "test-key");
    render(<ListingMap name="Café & Co" address="5 Elm St #2, Aurora, CO" placeId={null} />);
    const iframe = screen.getByTitle("Map of Café & Co");
    const src = iframe.getAttribute("src") ?? "";
    expect(src).toContain(encodeURIComponent("Café & Co, 5 Elm St #2, Aurora, CO"));
  });
});
