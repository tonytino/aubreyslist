import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { currentUserQuery } from "~/auth/current-user-query";
import type { RestaurantCardVM } from "~/components/listing/ListingCard";
import { favoriteIdsQuery } from "~/favorites/favorites-query";
import { DirectoryMap, type DirectoryMapEntry } from "./DirectoryMap";

// Each carousel entry carries a FavoriteButton island, which imports the
// `favorites.fn` server seam (transitively db-touching). As in
// FavoriteButton.test.tsx, mock it out — these tests only assert the heart
// renders as a sibling overlay, not its write behaviour.
vi.mock("~/server/favorites/favorites.fn", () => ({
  favoriteListing: vi.fn(() => Promise.resolve()),
  unfavoriteListing: vi.fn(() => Promise.resolve()),
}));

/**
 * Tests for the Map view's key-absent fallback path. Safety-relevant
 * behaviour: every pin/mini-card carries an accessible name that includes the
 * restaurant and its safety state (never colour alone); pin and carousel
 * selection stay in sync; and the carousel is stacked above the pins with an
 * opaque band so a pin can never bleed over a different restaurant's card. The
 * real-map path is covered (against a mocked Maps module) in
 * `DirectoryMapLive.test.tsx`.
 */

// Pin the browser key to absent for this whole file so the fallback renders
// deterministically even on a machine whose .env provisions a real key
// (Vitest loads .env like any Vite build).
beforeAll(() => {
  vi.stubEnv("VITE_GOOGLE_MAPS_BROWSER_KEY", "");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

function vm(overrides: Partial<RestaurantCardVM>): RestaurantCardVM {
  return {
    id: "id",
    name: "Name",
    address: "Addr",
    safetyState: null,
    suggestedByBot: false,
    suggestedAttributes: [],
    confirmedAttributes: [],
    hasRecentIncident: false,
    accent: "lavender",
    ...overrides,
  };
}

const entries: DirectoryMapEntry[] = [
  { vm: vm({ id: "a", name: "Root & Rye", safetyState: "celiac-safe" }), lat: 39.76, lng: -104.98 },
  {
    // hasRecentIncident alongside the "incident" headline: the accessible name
    // must not double up "Recent incident" (guard in pinAccessibleName).
    vm: vm({ id: "b", name: "Lucia Trattoria", safetyState: "incident", hasRecentIncident: true }),
    lat: 39.7,
    lng: -104.9,
  },
  { vm: vm({ id: "c", name: "New Spot", safetyState: null }), lat: 39.8, lng: -105.0 },
  // A recent incident on top of a positive headline verdict — the add-on chip case.
  {
    vm: vm({
      id: "d",
      name: "Harvest Table",
      safetyState: "celiac-safe",
      hasRecentIncident: true,
    }),
    lat: 39.72,
    lng: -104.95,
  },
  // No verdict but bot-suggested — the dashed empty-state chip is suppressed.
  {
    vm: vm({ id: "e", name: "Bot Bistro", safetyState: null, suggestedByBot: true }),
    lat: 39.74,
    lng: -104.93,
  },
];

function renderMap(selectedId: string | null = "a") {
  const onSelect = vi.fn();
  // Seed the favorites + current-user suspense queries the FavoriteButton reads
  // (anonymous, no favorites) so each carousel heart renders synchronously.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(favoriteIdsQuery.queryKey, []);
  queryClient.setQueryData(currentUserQuery.queryKey, null);
  const ui = (sel: string | null, ents: readonly DirectoryMapEntry[]) => (
    <QueryClientProvider client={queryClient}>
      <DirectoryMap entries={ents} selectedId={sel} onSelect={onSelect} />
    </QueryClientProvider>
  );
  const view = render(ui(selectedId, entries));
  return {
    onSelect,
    rerenderWith: (sel: string | null, ents: readonly DirectoryMapEntry[] = entries) =>
      view.rerender(ui(sel, ents)),
  };
}

/** The map pin among the two buttons sharing an accessible name (pin + card). */
function pinOf(name: string): HTMLElement {
  return screen
    .getAllByRole("button", { name })
    .find((el) => el.className.includes("size-11")) as HTMLElement;
}

/** The carousel mini-card among the two buttons sharing an accessible name. */
function cardOf(name: string): HTMLElement {
  return within(screen.getByTestId("map-carousel")).getByRole("button", { name });
}

describe("DirectoryMap — key-absent fallback (AUB-111)", () => {
  it("renders the stylized CSS placeholder when no browser key is provisioned", () => {
    renderMap();
    // The decorative backdrop only exists on the fallback path — with a key the
    // live Google canvas renders instead (DirectoryMapLive.test.tsx).
    expect(screen.getByTestId("map-placeholder-backdrop")).toBeInTheDocument();
    // The recenter FAB is present but unwired in the fallback.
    expect(screen.getByRole("button", { name: "Recenter map" })).toBeInTheDocument();
  });
});

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

  it("shows the index number in the dot instead of the safety icon (AUB-275 variant)", () => {
    renderMap();
    // The dot's only content is the number; the safety icon reaches sighted
    // users on the card's chip row (the variant's deliberate tradeoff).
    const pin = pinOf("Root & Rye, Celiac-safe");
    expect(pin.textContent).toBe("1");
    expect(pin.querySelector("svg")).not.toBeInTheDocument();
  });

  it("grows the selected dot unconditionally — size is state, only the transition is motion-gated", () => {
    renderMap("b");
    const pin = screen
      .getAllByRole("button", { name: "Lucia Trattoria, Recent incident" })
      .find((el) => el.className.includes("size-11")) as HTMLElement;
    const dot = pin.querySelector("span") as HTMLElement;
    // Reduced-motion users must still SEE the larger selected dot; only the
    // animation between states is motion-gated.
    expect(dot.className).toContain("scale-125");
    expect(dot.className).not.toContain("motion-safe:scale-125");
    expect(dot.className).toContain("motion-safe:transition-transform");
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

describe("DirectoryMap — numbered pins ↔ numbered cards (AUB-275 preview variant)", () => {
  // The five fixture entries' accessible names, in `entries` order — index i
  // must render the visible number i + 1 on both the pin and the card.
  const names = [
    "Root & Rye, Celiac-safe",
    "Lucia Trattoria, Recent incident",
    "New Spot, Not yet attested",
    "Harvest Table, Celiac-safe, Recent incident",
    "Bot Bistro, Not yet attested",
  ];

  it("shows the same 1-based number on pin N and card N, following the entries order", () => {
    renderMap();
    names.forEach((name, i) => {
      const number = String(i + 1);
      // The pin's only visible content is the number…
      expect(pinOf(name).textContent).toBe(number);
      // …and the card's leading chip carries the matching number.
      expect(within(cardOf(name)).getByText(number)).toBeInTheDocument();
    });
  });

  it("numbers the unattested pin too (grey fill, no fake verdict — still a numbered dot)", () => {
    renderMap();
    const pin = pinOf("New Spot, Not yet attested");
    expect(pin.textContent).toBe("3");
    // Still the neutral unattested pairing, never a safety-state fill.
    expect((pin.querySelector("span") as HTMLElement).className).toContain("bg-muted-foreground");
  });

  it("keeps the number out of every accessible name — a visual correlation aid only", () => {
    renderMap();
    names.forEach((name) => {
      // Exactly the shared pinAccessibleName on both buttons (getAllByRole with
      // a string is a full exact match), and no digit anywhere in the label.
      const buttons = screen.getAllByRole("button", { name });
      expect(buttons).toHaveLength(2);
      for (const button of buttons) {
        expect(button.getAttribute("aria-label")).toBe(name);
        expect(button.getAttribute("aria-label")).not.toMatch(/\d/);
      }
    });
  });

  it("fits two-digit numbers in the 24px dot by dropping to the smaller type size", () => {
    const many: DirectoryMapEntry[] = Array.from({ length: 12 }, (_, i) => ({
      vm: vm({
        id: `m${i}`,
        name: `Spot ${String.fromCharCode(65 + i)}`,
        safetyState: "celiac-safe",
      }),
      lat: 39.7 + i * 0.005,
      lng: -104.9 - i * 0.005,
    }));
    const { rerenderWith } = renderMap(null);
    rerenderWith(null, many);

    const first = pinOf("Spot A, Celiac-safe");
    const twelfth = pinOf("Spot L, Celiac-safe");
    expect(first.textContent).toBe("1");
    expect(twelfth.textContent).toBe("12");
    // Single digits render at text-caption; two digits shrink so "12" fits
    // the dot's ~20px interior. Both stay tabular so widths are stable.
    const numberSpanOf = (pin: HTMLElement) => pin.querySelector("span > span") as HTMLElement;
    expect(numberSpanOf(first).className).toContain("text-caption");
    expect(numberSpanOf(twelfth).className).toContain("text-[10px]");
    expect(numberSpanOf(twelfth).className).toContain("tabular-nums");
    // The card mirrors the two-digit number.
    expect(within(cardOf("Spot L, Celiac-safe")).getByText("12")).toBeInTheDocument();
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
    // Root & Rye's carousel button contains only its own celiac-safe chip, never
    // another restaurant's incident signal.
    const rootCard = within(carousel).getByRole("button", { name: "Root & Rye, Celiac-safe" });
    expect(within(rootCard).getByText("Celiac-safe")).toBeInTheDocument();
    expect(within(rootCard).queryByText("Recent incident")).not.toBeInTheDocument();
  });
});

describe("DirectoryMap — mini-card trust row mirrors ListingCard (AUB-274)", () => {
  it("adds the incident chip alongside the headline verdict when hasRecentIncident", () => {
    renderMap();
    const carousel = screen.getByTestId("map-carousel");
    // Recent harm must never read clean on the map: the card keeps its
    // headline chip AND flags the incident, exactly like the browse card.
    const card = within(carousel).getByRole("button", {
      name: "Harvest Table, Celiac-safe, Recent incident",
    });
    expect(within(card).getByText("Celiac-safe")).toBeInTheDocument();
    expect(within(card).getByText("Recent incident")).toBeInTheDocument();
  });

  it("folds the incident into the ACCESSIBLE name of both the pin and the mini-card", () => {
    renderMap();
    // aria-label overrides button content, so the visual incident chip alone
    // would be sighted-only. The shared name construction appends it: what
    // sighted users see is what screen readers hear — on the pin AND the card.
    expect(
      screen.getAllByRole("button", { name: "Harvest Table, Celiac-safe, Recent incident" })
    ).toHaveLength(2);
    // Never doubled when the headline already IS the incident state.
    expect(
      screen.getAllByRole("button", { name: "Lucia Trattoria, Recent incident" })
    ).toHaveLength(2);
  });

  it("suppresses the dashed empty-state chip for a bot-suggested listing with no verdict", () => {
    renderMap();
    const carousel = screen.getByTestId("map-carousel");
    // Same gate as ListingCard: bot-suggested + null verdict shows no
    // fabricated-looking empty-state chip (provenance lives elsewhere)…
    const botCard = within(carousel).getByRole("button", { name: "Bot Bistro, Not yet attested" });
    expect(within(botCard).queryByText("Not yet attested")).not.toBeInTheDocument();
    // …while a plain unattested listing still shows the honest dashed chip.
    const plainCard = within(carousel).getByRole("button", { name: "New Spot, Not yet attested" });
    expect(within(plainCard).getByText("Not yet attested")).toBeInTheDocument();
  });
});

describe("DirectoryMap — carousel scrolls the selected card into view (AUB-274)", () => {
  // jsdom doesn't implement scrollIntoView; the spy doubles as the polyfill so
  // the tests can assert both the target element and the scroll options.
  const scrollIntoView = vi.fn();
  beforeAll(() => {
    Element.prototype.scrollIntoView = scrollIntoView;
  });
  afterEach(() => {
    scrollIntoView.mockClear();
    vi.unstubAllGlobals();
  });

  it("does not scroll on mount, nor when the initial auto-select lands post-mount", () => {
    const { rerenderWith } = renderMap(null);
    // The route's auto-select-first arrives right after mount — still the
    // initial selection, so nothing animates.
    rerenderWith("a");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("smooth-scrolls the newly selected card into view without scrolling the page", () => {
    const { rerenderWith } = renderMap("a");
    rerenderWith("b");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    // inline centering only; block "nearest" so the page itself never jumps.
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
    // The scrolled element is the selected entry's own card wrapper.
    const target = scrollIntoView.mock.contexts[0] as HTMLElement;
    expect(
      within(target).getByRole("button", { name: "Lucia Trattoria, Recent incident" })
    ).toBeInTheDocument();
  });

  it("does not scroll when the previous selection was filtered away (validity reassign, not a tap)", () => {
    const { rerenderWith } = renderMap("a");
    // A real tap first, so the discriminator is past its initial-selection skip.
    rerenderWith("b");
    scrollIntoView.mockClear();
    // Filter change drops "b"; the route reassigns to the first survivor —
    // the shared discriminator must read that as a reassign, not a tap.
    const withoutB = entries.filter((entry) => entry.vm.id !== "b");
    rerenderWith("a", withoutB);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls instantly (behavior 'auto') under prefers-reduced-motion", () => {
    const { rerenderWith } = renderMap("a");
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true } as unknown as MediaQueryList)
    );
    rerenderWith("b");
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      inline: "center",
      block: "nearest",
    });
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
