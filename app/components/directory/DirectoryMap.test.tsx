import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { currentUserQuery } from "~/auth/current-user-query";
import type { RestaurantCardVM } from "~/components/listing/ListingCard";
import { favoriteIdsQuery } from "~/favorites/favorites-query";
import { DirectoryMap, type DirectoryMapEntry } from "./DirectoryMap";

// Each carousel entry now carries a FavoriteButton island (F6, AUB-125), which
// imports the `favorites.fn` server seam (transitively db-touching). As in
// FavoriteButton.test.tsx we mock it out — these tests only assert the heart
// renders as a sibling overlay, not its write behaviour.
vi.mock("~/server/favorites/favorites.fn", () => ({
  favoriteListing: vi.fn(() => Promise.resolve()),
  unfavoriteListing: vi.fn(() => Promise.resolve()),
}));

/**
 * Tests for the stylized Map view (AUB-61, Phase 2b). Safety-relevant behaviour:
 * every pin/mini-card carries an accessible name that includes the restaurant AND
 * its safety state (never colour alone); pin and carousel selection stay in sync;
 * and the carousel is stacked ABOVE the pins with an opaque band so a pin can
 * never bleed over a different restaurant's card.
 */

function vm(overrides: Partial<RestaurantCardVM>): RestaurantCardVM {
  return {
    id: "id",
    name: "Name",
    address: "Addr",
    safetyState: null,
    suggestedByBot: false,
    hasRecentIncident: false,
    accent: "lavender",
    ...overrides,
  };
}

const entries: DirectoryMapEntry[] = [
  { vm: vm({ id: "a", name: "Root & Rye", safetyState: "celiac-safe" }), lat: 39.76, lng: -104.98 },
  {
    vm: vm({ id: "b", name: "Lucia Trattoria", safetyState: "incident" }),
    lat: 39.7,
    lng: -104.9,
  },
  { vm: vm({ id: "c", name: "New Spot", safetyState: null }), lat: 39.8, lng: -105.0 },
];

function renderMap(selectedId: string | null = "a") {
  const onSelect = vi.fn();
  // Seed the favorites + current-user suspense queries the FavoriteButton reads
  // (anonymous, no favorites) so each carousel heart renders synchronously.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(favoriteIdsQuery.queryKey, []);
  queryClient.setQueryData(currentUserQuery.queryKey, null);
  render(
    <QueryClientProvider client={queryClient}>
      <DirectoryMap entries={entries} selectedId={selectedId} onSelect={onSelect} />
    </QueryClientProvider>
  );
  return { onSelect };
}

describe("DirectoryMap — pins", () => {
  it("labels each pin with the restaurant name AND its safety state", () => {
    renderMap();
    // Both the pin and the mini-card share the accessible name, so there are two.
    expect(screen.getAllByRole("button", { name: "Root & Rye, Celiac-safe" }).length).toBe(2);
    expect(screen.getAllByRole("button", { name: "Lucia Trattoria, Recent incident" }).length).toBe(
      2
    );
  });

  it("renders an honest 'Not yet attested' label for a null safety state (no fake verdict)", () => {
    renderMap();
    expect(screen.getAllByRole("button", { name: "New Spot, Not yet attested" }).length).toBe(2);
  });

  it("marks the selected entry via aria-pressed on both its pin and mini-card", () => {
    renderMap("b");
    const pressed = screen
      .getAllByRole("button", { name: "Lucia Trattoria, Recent incident" })
      .filter((el) => el.getAttribute("aria-pressed") === "true");
    // Both the pin and the carousel card reflect the selection.
    expect(pressed).toHaveLength(2);
  });

  it("selects the same restaurant whether its pin or its mini-card is tapped", () => {
    const { onSelect } = renderMap("a");
    const targets = screen.getAllByRole("button", { name: "Lucia Trattoria, Recent incident" });
    fireEvent.click(targets[0] as HTMLElement);
    fireEvent.click(targets[1] as HTMLElement);
    // Pin and mini-card both request the same id (selection stays in sync).
    expect(onSelect).toHaveBeenNthCalledWith(1, "b");
    expect(onSelect).toHaveBeenNthCalledWith(2, "b");
  });
});

describe("DirectoryMap — carousel-above-pins safety invariant", () => {
  it("renders the carousel as an opaque, raised band (z-10 + bg) above the pins", () => {
    renderMap();
    const carousel = screen.getByTestId("map-carousel");
    // The opaque background band + raised stacking are what stop a low pin from
    // visually floating over a different card (a mis-associated safety signal).
    expect(carousel.className).toContain("z-10");
    expect(carousel.className).toContain("bg-background");
  });

  it("keeps a mini-card's safety chip inside that same card (no cross-card bleed in the DOM)", () => {
    renderMap();
    const carousel = screen.getByTestId("map-carousel");
    // Root & Rye's carousel button contains ONLY its own celiac-safe chip, never
    // another restaurant's incident signal.
    const rootCard = within(carousel).getByRole("button", { name: "Root & Rye, Celiac-safe" });
    expect(within(rootCard).getByText("Celiac-safe")).toBeInTheDocument();
    expect(within(rootCard).queryByText("Recent incident")).not.toBeInTheDocument();
  });
});

describe("DirectoryMap — carousel FavoriteButton (F6, AUB-125)", () => {
  it("renders a FavoriteButton for each carousel entry", () => {
    renderMap();
    const carousel = screen.getByTestId("map-carousel");
    // One heart per entry, labelled from the listing name (anonymous → "Save …").
    expect(within(carousel).getByRole("button", { name: "Save Root & Rye" })).toBeInTheDocument();
    expect(
      within(carousel).getByRole("button", { name: "Save Lucia Trattoria" })
    ).toBeInTheDocument();
    expect(within(carousel).getByRole("button", { name: "Save New Spot" })).toBeInTheDocument();
  });

  it("wires the heart as a SIBLING overlay, never nested inside the mini-card button", () => {
    renderMap();
    const carousel = screen.getByTestId("map-carousel");
    // A <button> inside the mini-card <button> would be invalid HTML + nested
    // interactive; the heart must be a sibling, not a descendant.
    const miniCard = within(carousel).getByRole("button", { name: "Root & Rye, Celiac-safe" });
    const heart = within(carousel).getByRole("button", { name: "Save Root & Rye" });
    expect(miniCard).not.toContainElement(heart);
    expect(heart).not.toContainElement(miniCard);
  });
});
