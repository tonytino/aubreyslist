import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the embedded per-restaurant map (ADR-014). Each test pins
 * `VITE_GOOGLE_MAPS_BROWSER_KEY` explicitly via `vi.stubEnv` so results are
 * deterministic regardless of whether the machine has a real key in `.env`.
 *
 * The composition suite mirrors the detail route's structure — `ListingMap` as a
 * sibling above the `ListingLinks` "Links" region: the "Open in Google Maps"
 * deep-link (the mobile hand-off, ADR-014) must render alongside the map and
 * without it, and the iframe must never land inside the "Links" region (whose
 * link/button roles the edit-listing-links E2E spec asserts).
 */

// ListingLinks pulls in the listing-links server-fn seam (transitively
// db-touching) and sonner; both are irrelevant to this composition test, so
// mock them out (same approach as ListingLinks.test.tsx).
vi.mock("~/server/listing-links/links.fn", () => ({
  submitListingLink: vi.fn(() => Promise.resolve()),
  deleteListingLink: vi.fn(() => Promise.resolve()),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ListingLinks } from "./ListingLinks";
import { ListingMap } from "./ListingMap";

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

/**
 * Render the map + links exactly as the detail route composes them: the map
 * as a sibling section above the "Links" region (see listings.$id.tsx).
 */
function renderDetailComposition() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ListingMap name="Root & Rye" address="123 Main St, Denver, CO" placeId="ChIJ123abc" />
      <ListingLinks
        listingId="listing-1"
        mapsUrl="https://maps.google.com/?cid=42"
        legacyMenuUrl={null}
        links={[]}
        isSignedIn={false}
      />
    </QueryClientProvider>
  );
}

describe("ListingMap + ListingLinks composition (detail-route regression)", () => {
  it("keeps the 'Open in Google Maps' deep-link rendering ALONGSIDE the map (key present)", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_BROWSER_KEY", "test-key");
    renderDetailComposition();

    // Both surfaces render: the embed preview and the deep-link hand-off.
    const iframe = screen.getByTitle("Map of Root & Rye");
    const deepLink = screen.getByRole("link", { name: "Open in Google Maps" });
    expect(iframe).toBeInTheDocument();
    expect(deepLink).toHaveAttribute("href", "https://maps.google.com/?cid=42");

    // The iframe stays outside the "Links" region — a sibling, never a child —
    // so the region's role contents the E2E spec asserts are unchanged.
    const linksRegion = screen.getByRole("region", { name: "Links" });
    expect(within(linksRegion).queryByTitle("Map of Root & Rye")).not.toBeInTheDocument();
    expect(within(linksRegion).getAllByRole("link")).toHaveLength(1);
  });

  it("keeps the 'Open in Google Maps' deep-link rendering WITHOUT the map (key absent)", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_BROWSER_KEY", "");
    renderDetailComposition();

    expect(screen.queryByTitle("Map of Root & Rye")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in Google Maps" })).toHaveAttribute(
      "href",
      "https://maps.google.com/?cid=42"
    );
  });
});
