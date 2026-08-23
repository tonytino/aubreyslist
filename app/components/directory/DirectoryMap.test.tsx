import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useReducer } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { currentUserQuery } from "~/auth/current-user-query";
import type { RestaurantCardVM } from "~/components/listing/ListingCard";
import { favoriteIdsQuery } from "~/favorites/favorites-query";
import { DirectoryMap, type DirectoryMapEntry, resetLiveMapFailureLatch } from "./DirectoryMap";

// Each carousel entry carries a FavoriteButton island, which imports the
// `favorites.fn` server seam (transitively db-touching). As in
// FavoriteButton.test.tsx, mock it out — these tests only assert the heart
// renders as a sibling overlay, not its write behaviour.
vi.mock("~/server/favorites/favorites.fn", () => ({
  favoriteListing: vi.fn(() => Promise.resolve()),
  unfavoriteListing: vi.fn(() => Promise.resolve()),
}));

// The live path's internals are covered in DirectoryMapLive.test.tsx against a
// mocked Maps module; here a controllable stub stands in so the
// failure-fallback tests can make the live subtree crash on demand without
// pulling the real vis.gl runtime into jsdom.
const liveMapMock = vi.hoisted(() => ({ throwOnRender: false }));

// Every live-map failure must reach Sentry (the local boundary keeps it from
// RootErrorBoundary's capture) — mocked at the module seam so the fallback
// tests can assert the report without a DSN.
const sentryMock = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock("@sentry/tanstackstart-react", () => sentryMock);
vi.mock("~/components/directory/DirectoryMapLive", () => ({
  DirectoryMapLive: () => {
    if (liveMapMock.throwOnRender) {
      // Stand-in for the minified vis.gl marker throws that a half-initialized
      // Maps runtime produces after an async auth rejection.
      throw new Error("maps runtime half-initialized");
    }
    return <div data-testid="live-map-stub" />;
  },
}));

/**
 * Tests for the Map view's key-absent fallback path. Safety-relevant
 * behaviour: every pin/mini-card carries an accessible name that includes the
 * restaurant and its safety state (never colour alone); pin and carousel
 * selection stay in sync; and the carousel is stacked above the pins with an
 * opaque band so a pin can never bleed over a different restaurant's card. The
 * real-map path is covered (against a mocked Maps module) in
 * `DirectoryMapLive.test.tsx`; the live-map failure fallback is covered here,
 * against the stubs above.
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
  {
    // Carries a server-derived distance label — the mini-card must show it in
    // place of the address.
    vm: vm({ id: "a", name: "Root & Rye", safetyState: "celiac-safe", distanceLabel: "0.8 mi" }),
    lat: 39.76,
    lng: -104.98,
  },
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
  // No verdict but bot-suggested — the dashed empty-state chip gives way to the
  // provenance hint.
  {
    vm: vm({ id: "e", name: "Bot Bistro", safetyState: null, suggestedByBot: true }),
    lat: 39.74,
    lng: -104.93,
  },
];

/**
 * Mount the map inside a minimal real router (the carousel's chevron links and
 * tap-again navigation need one). Props flow through a mutable box plus an
 * external re-render signal, so `rerenderWith` updates the same mounted tree —
 * the selection discriminator lives in refs that a remount would reset.
 */
async function renderMap(selectedId: string | null = "a") {
  const onSelect = vi.fn();
  // Seed the favorites + current-user suspense queries the FavoriteButton reads
  // (anonymous, no favorites) so each carousel heart renders synchronously.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(favoriteIdsQuery.queryKey, []);
  queryClient.setQueryData(currentUserQuery.queryKey, null);

  const box: { selectedId: string | null; entries: readonly DirectoryMapEntry[] } = {
    selectedId,
    entries,
  };
  const listeners = new Set<() => void>();
  function Harness() {
    const [, force] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
      listeners.add(force);
      return () => {
        listeners.delete(force);
      };
    }, []);
    return (
      <QueryClientProvider client={queryClient}>
        <DirectoryMap entries={box.entries} selectedId={box.selectedId} onSelect={onSelect} />
      </QueryClientProvider>
    );
  }

  const rootRoute = createRootRoute();
  const mapRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Harness });
  const listingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/listings/$id",
    component: () => <div data-testid="listing-detail" />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([mapRoute, listingRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const view = render(<RouterProvider router={router as unknown as never} />);
  await screen.findByTestId("map-carousel");
  return {
    onSelect,
    router,
    unmount: () => view.unmount(),
    rerenderWith: (sel: string | null, ents: readonly DirectoryMapEntry[] = entries) => {
      box.selectedId = sel;
      box.entries = ents;
      act(() => {
        for (const listener of listeners) listener();
      });
    },
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
  it("renders the stylized CSS placeholder when no browser key is provisioned", async () => {
    await renderMap();
    // The decorative backdrop only exists on the fallback path — with a key the
    // live Google canvas renders instead (DirectoryMapLive.test.tsx).
    expect(screen.getByTestId("map-placeholder-backdrop")).toBeInTheDocument();
    // The recenter FAB is present but unwired in the fallback.
    expect(screen.getByRole("button", { name: "Recenter map" })).toBeInTheDocument();
  });
});

describe("DirectoryMap — pins", () => {
  it("labels each pin with the restaurant name AND its safety state", async () => {
    await renderMap();
    // Both the pin and the mini-card share the accessible name, so there are two.
    expect(screen.getAllByRole("button", { name: "Root & Rye, Celiac-safe" }).length).toBe(2);
    expect(screen.getAllByRole("button", { name: "Lucia Trattoria, Recent incident" }).length).toBe(
      2
    );
  });

  it("renders an honest 'Not yet attested' label for a null safety state (no fake verdict)", async () => {
    await renderMap();
    expect(screen.getAllByRole("button", { name: "New Spot, Not yet attested" }).length).toBe(2);
  });

  it("marks the selected entry via aria-pressed on both its pin and mini-card", async () => {
    await renderMap("b");
    const pressed = screen
      .getAllByRole("button", { name: "Lucia Trattoria, Recent incident" })
      .filter((el) => el.getAttribute("aria-pressed") === "true");
    // Both the pin and the carousel card reflect the selection.
    expect(pressed).toHaveLength(2);
  });

  it("shows the index number in the dot instead of the safety icon (AUB-275 variant)", async () => {
    await renderMap();
    // The dot's only content is the number; the safety icon reaches sighted
    // users on the card's chip row (the variant's deliberate tradeoff).
    const pin = pinOf("Root & Rye, Celiac-safe");
    expect(pin.textContent).toBe("1");
    expect(pin.querySelector("svg")).not.toBeInTheDocument();
  });

  it("grows the selected dot unconditionally — size is state, only the transition is motion-gated", async () => {
    await renderMap("b");
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

  it("selects the same restaurant whether its pin or its mini-card is tapped", async () => {
    const { onSelect } = await renderMap("a");
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

  it("shows the same 1-based number on pin N and card N, following the entries order", async () => {
    await renderMap();
    names.forEach((name, i) => {
      const number = String(i + 1);
      // The pin's only visible content is the number…
      expect(pinOf(name).textContent).toBe(number);
      // …and the card's leading chip carries the matching number.
      expect(within(cardOf(name)).getByText(number)).toBeInTheDocument();
    });
  });

  it("numbers the unattested pin too (grey fill, no fake verdict — still a numbered dot)", async () => {
    await renderMap();
    const pin = pinOf("New Spot, Not yet attested");
    expect(pin.textContent).toBe("3");
    // Still the neutral unattested pairing, never a safety-state fill.
    expect((pin.querySelector("span") as HTMLElement).className).toContain("bg-muted-foreground");
  });

  it("keeps the number out of every accessible name — a visual correlation aid only", async () => {
    await renderMap();
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

  it("fits two-digit numbers in the 24px dot by dropping to the smaller type size", async () => {
    const many: DirectoryMapEntry[] = Array.from({ length: 12 }, (_, i) => ({
      vm: vm({
        id: `m${i}`,
        name: `Spot ${String.fromCharCode(65 + i)}`,
        safetyState: "celiac-safe",
      }),
      lat: 39.7 + i * 0.005,
      lng: -104.9 - i * 0.005,
    }));
    const { rerenderWith } = await renderMap(null);
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
  it("renders the carousel as an opaque, raised band (z-10 + bg) above the pins", async () => {
    await renderMap();
    const carousel = screen.getByTestId("map-carousel");
    // The opaque background band + raised stacking are what stop a low pin from
    // visually floating over a different card (a mis-associated safety signal).
    expect(carousel.className).toContain("z-10");
    expect(carousel.className).toContain("bg-background");
  });

  it("keeps a mini-card's safety chip inside that same card (no cross-card bleed in the DOM)", async () => {
    await renderMap();
    const carousel = screen.getByTestId("map-carousel");
    // Root & Rye's carousel button contains only its own celiac-safe chip, never
    // another restaurant's incident signal.
    const rootCard = within(carousel).getByRole("button", { name: "Root & Rye, Celiac-safe" });
    expect(within(rootCard).getByText("Celiac-safe")).toBeInTheDocument();
    expect(within(rootCard).queryByText("Recent incident")).not.toBeInTheDocument();
  });
});

describe("DirectoryMap — mini-card trust row mirrors ListingCard (AUB-274)", () => {
  it("adds the incident chip alongside the headline verdict when hasRecentIncident", async () => {
    await renderMap();
    const carousel = screen.getByTestId("map-carousel");
    // Recent harm must never read clean on the map: the card keeps its
    // headline chip AND flags the incident, exactly like the browse card.
    const card = within(carousel).getByRole("button", {
      name: "Harvest Table, Celiac-safe, Recent incident",
    });
    expect(within(card).getByText("Celiac-safe")).toBeInTheDocument();
    expect(within(card).getByText("Recent incident")).toBeInTheDocument();
  });

  it("folds the incident into the ACCESSIBLE name of both the pin and the mini-card", async () => {
    await renderMap();
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

  it("shows the bot-provenance hint (never the dashed chip) for a bot-suggested listing with no verdict", async () => {
    await renderMap();
    const carousel = screen.getByTestId("map-carousel");
    // Same gate as ListingCard: bot-suggested + null verdict never shows a
    // fabricated-looking empty-state chip. The trust row carries the list
    // card's exact provenance wording instead of sitting empty…
    const botCard = within(carousel).getByRole("button", { name: "Bot Bistro, Not yet attested" });
    expect(within(botCard).queryByText("Not yet attested")).not.toBeInTheDocument();
    const provenance = within(botCard).getByTestId("carousel-bot-provenance");
    expect(provenance).toHaveTextContent("Suggested by Aubrey's Bot");
    // …and the accessible name still tells AT the honest verdict state.
    expect(botCard.getAttribute("aria-label")).toBe("Bot Bistro, Not yet attested");
  });

  it("keeps the honest dashed chip (and no provenance hint) for a plain unattested listing", async () => {
    await renderMap();
    const carousel = screen.getByTestId("map-carousel");
    const plainCard = within(carousel).getByRole("button", { name: "New Spot, Not yet attested" });
    expect(within(plainCard).getByText("Not yet attested")).toBeInTheDocument();
    expect(within(plainCard).queryByTestId("carousel-bot-provenance")).not.toBeInTheDocument();
  });
});

describe("DirectoryMap — mini-card distance line", () => {
  it("shows the server-derived distance in place of the address when present", async () => {
    await renderMap();
    const card = cardOf("Root & Rye, Celiac-safe");
    // The same "0.8 mi" label the browse list card renders — never new phrasing.
    expect(within(card).getByText("0.8 mi")).toBeInTheDocument();
    expect(within(card).queryByText("Addr")).not.toBeInTheDocument();
  });

  it("falls back to the address when no distance exists (never an empty row)", async () => {
    await renderMap();
    const card = cardOf("New Spot, Not yet attested");
    expect(within(card).getByText("Addr")).toBeInTheDocument();
  });
});

describe("DirectoryMap — carousel scrolls the selected card flush-left", () => {
  // jsdom doesn't implement element scrolling; the spy doubles as the
  // implementation so the tests can assert the scrolled container + options.
  const scrollTo = vi.fn();
  beforeAll(() => {
    Element.prototype.scrollTo = scrollTo as unknown as Element["scrollTo"];
  });
  afterEach(() => {
    scrollTo.mockClear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not scroll on mount, nor when the initial auto-select lands post-mount", async () => {
    const { rerenderWith } = await renderMap(null);
    // The route's auto-select-first arrives right after mount — still the
    // initial selection, so nothing animates.
    rerenderWith("a");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls the CAROUSEL ELEMENT to the selected card's flush-left offset (card offset minus band padding)", async () => {
    const { rerenderWith } = await renderMap("a");
    const carousel = screen.getByTestId("map-carousel");
    // Simulate real layout: the selected card's wrapper sits 432px into the
    // strip and the band has 16px of left padding (px-4).
    const wrapper = cardOf("Lucia Trattoria, Recent incident").parentElement as HTMLElement;
    Object.defineProperty(wrapper, "offsetLeft", { value: 432, configurable: true });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      paddingLeft: "16px",
    } as CSSStyleDeclaration);

    rerenderWith("b");
    expect(scrollTo).toHaveBeenCalledTimes(1);
    // The scroll target is the carousel itself — never scrollIntoView, which
    // walks every scroll ancestor and can move the page (and whose options
    // object is unreliable in mobile Safari).
    expect(scrollTo.mock.contexts[0]).toBe(carousel);
    expect(scrollTo).toHaveBeenCalledWith({ left: 416, behavior: "smooth" });
  });

  it("does not scroll when the previous selection was filtered away (validity reassign, not a tap)", async () => {
    const { rerenderWith } = await renderMap("a");
    // A real tap first, so the discriminator is past its initial-selection skip.
    rerenderWith("b");
    scrollTo.mockClear();
    // Filter change drops "b"; the route reassigns to the first survivor —
    // the shared discriminator must read that as a reassign, not a tap.
    const withoutB = entries.filter((entry) => entry.vm.id !== "b");
    rerenderWith("a", withoutB);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls instantly (behavior 'auto') under prefers-reduced-motion", async () => {
    const { rerenderWith } = await renderMap("a");
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true } as unknown as MediaQueryList)
    );
    rerenderWith("b");
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: "auto" });
  });
});

describe("DirectoryMap — mini-card navigation (AUB-283)", () => {
  it("navigates to the listing when the ALREADY-SELECTED card is tapped (no re-select)", async () => {
    const { onSelect, router } = await renderMap("a");
    fireEvent.click(cardOf("Root & Rye, Celiac-safe"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/listings/a"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("still only selects on the first tap of an unselected card", async () => {
    const { onSelect, router } = await renderMap("a");
    fireEvent.click(cardOf("Lucia Trattoria, Recent incident"));
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(router.state.location.pathname).toBe("/");
  });

  it("keeps pin behaviour unchanged: tapping the selected PIN re-selects, never navigates", async () => {
    const { onSelect, router } = await renderMap("a");
    fireEvent.click(pinOf("Root & Rye, Celiac-safe"));
    expect(onSelect).toHaveBeenCalledWith("a");
    expect(router.state.location.pathname).toBe("/");
  });
});

describe("DirectoryMap — chevron link (AUB-283)", () => {
  it("renders an always-visible chevron link per card with its own accessible name", async () => {
    await renderMap("a");
    for (const name of ["Root & Rye", "Lucia Trattoria", "New Spot", "Harvest Table"]) {
      expect(screen.getByRole("link", { name: `View ${name}` })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "View Root & Rye" })).toHaveAttribute(
      "href",
      "/listings/a"
    );
  });

  it("mutes the unselected chevron and strengthens the selected one to brand", async () => {
    await renderMap("a");
    const selectedChevron = screen.getByRole("link", { name: "View Root & Rye" });
    const mutedChevron = screen.getByRole("link", { name: "View New Spot" });
    expect(selectedChevron.className).toContain("bg-brand");
    expect(selectedChevron.className).toContain("text-brand-foreground");
    expect(mutedChevron.className).toContain("text-muted-foreground");
    expect(mutedChevron.className).not.toContain("bg-brand ");
  });

  it("navigates when the chevron itself is tapped — the accessible path to the listing", async () => {
    const { onSelect, router } = await renderMap("a");
    fireEvent.click(screen.getByRole("link", { name: "View New Spot" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/listings/c"));
    // A chevron tap is navigation, never a selection change.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps the chevron a SIBLING overlay, never nested inside the mini-card button", async () => {
    await renderMap("a");
    const miniCard = cardOf("Root & Rye, Celiac-safe");
    const chevron = screen.getByRole("link", { name: "View Root & Rye" });
    // An interactive element inside the mini-card <button> would be invalid
    // HTML + a nested-interactive a11y defect (same rule as the heart).
    expect(miniCard).not.toContainElement(chevron);
    expect(chevron).not.toContainElement(miniCard);
  });
});

describe("DirectoryMap — carousel FavoriteButton (F6, AUB-125)", () => {
  it("renders a FavoriteButton for each carousel entry", async () => {
    await renderMap();
    const carousel = screen.getByTestId("map-carousel");
    // One heart per entry, labelled from the listing name (anonymous → "Save …").
    expect(within(carousel).getByRole("button", { name: "Save Root & Rye" })).toBeInTheDocument();
    expect(
      within(carousel).getByRole("button", { name: "Save Lucia Trattoria" })
    ).toBeInTheDocument();
    expect(within(carousel).getByRole("button", { name: "Save New Spot" })).toBeInTheDocument();
  });

  it("wires the heart as a SIBLING overlay, never nested inside the mini-card button", async () => {
    await renderMap();
    const carousel = screen.getByTestId("map-carousel");
    // A <button> inside the mini-card <button> would be invalid HTML + nested
    // interactive; the heart must be a sibling, not a descendant.
    const miniCard = within(carousel).getByRole("button", { name: "Root & Rye, Celiac-safe" });
    const heart = within(carousel).getByRole("button", { name: "Save Root & Rye" });
    expect(miniCard).not.toContainElement(heart);
    expect(heart).not.toContainElement(miniCard);
  });
});

describe("DirectoryMap — carousel end spacer (Add-listing FAB clearance)", () => {
  it("ends the strip with a hidden spacer so the last card can scroll clear of the FAB", async () => {
    await renderMap();
    const carousel = screen.getByTestId("map-carousel");
    const spacer = within(carousel).getByTestId("carousel-end-spacer");
    // Decorative scroll room only — invisible to AT, fixed width, never shrinks.
    expect(spacer).toHaveAttribute("aria-hidden", "true");
    expect(spacer.className).toContain("w-40");
    expect(spacer.className).toContain("shrink-0");
    // It must trail every card to give the strip its end clearance.
    expect(carousel.lastElementChild).toBe(spacer);
  });
});

describe("DirectoryMap — live-map failure fallback (AUB-281)", () => {
  // These tests need the key-present path; the seam is the same env accessor
  // (app/lib/public-env.ts) the file-level stub pins to absent.
  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_BROWSER_KEY", "test-key");
    resetLiveMapFailureLatch();
  });
  afterEach(() => {
    vi.stubEnv("VITE_GOOGLE_MAPS_BROWSER_KEY", "");
    liveMapMock.throwOnRender = false;
    resetLiveMapFailureLatch();
    window.gm_authFailure = undefined;
    sentryMock.captureException.mockClear();
    sentryMock.captureMessage.mockClear();
    vi.restoreAllMocks();
  });

  it("renders the live path, not the placeholder, when a key is provisioned", async () => {
    await renderMap();
    expect(screen.getByTestId("live-map-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("map-placeholder-backdrop")).not.toBeInTheDocument();
  });

  it("shares the carousel between paths: distance line and chevron render in the live path too", async () => {
    await renderMap();
    // MapCarousel is rendered by DirectoryMap outside the live/placeholder
    // switch, so the card-content contract holds identically in both paths.
    const card = cardOf("Root & Rye, Celiac-safe");
    expect(within(card).getByText("0.8 mi")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Root & Rye" })).toBeInTheDocument();
    expect(
      within(screen.getByTestId("map-carousel")).getByTestId("carousel-end-spacer")
    ).toBeInTheDocument();
  });

  it("degrades to the placeholder WITH the carousel intact when the live map throws during render", async () => {
    liveMapMock.throwOnRender = true;
    // React logs boundary-caught errors and the fail handler warns — both
    // expected here, neither useful as test noise.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderMap();
    expect(screen.getByTestId("map-placeholder-backdrop")).toBeInTheDocument();
    // Guards the route-level invariant: a live-map throw must never unmount
    // the carousel (the root error page would otherwise replace the whole
    // browse route).
    expect(screen.getByTestId("map-carousel")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Root & Rye, Celiac-safe" }).length).toBe(2);
    // The degrade is silent for users but not for operators: the original
    // throw reaches Sentry.
    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "maps runtime half-initialized" })
    );
  });

  it("degrades to the placeholder when Google rejects the key (window.gm_authFailure)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderMap();
    expect(screen.getByTestId("live-map-stub")).toBeInTheDocument();
    // The live path registered Google's auth-failure hook…
    expect(window.gm_authFailure).toBeTypeOf("function");
    // …and Google calling it (async, post-load) flips the view to the fallback.
    act(() => {
      window.gm_authFailure?.();
    });
    expect(screen.queryByTestId("live-map-stub")).not.toBeInTheDocument();
    expect(screen.getByTestId("map-placeholder-backdrop")).toBeInTheDocument();
    expect(screen.getByTestId("map-carousel")).toBeInTheDocument();
    // No throw to preserve on this signal, so the report is a Sentry message.
    expect(sentryMock.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("rejected the Maps key"),
      "warning"
    );
  });

  it("latches the failure for the whole page load: a remount starts on the placeholder", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { unmount } = await renderMap();
    act(() => {
      window.gm_authFailure?.();
    });
    unmount();
    // Maps can't recover without a reload and gm_authFailure never fires
    // twice, so the List→Map toggle's remount must not retry the live path.
    await renderMap();
    expect(screen.queryByTestId("live-map-stub")).not.toBeInTheDocument();
    expect(screen.getByTestId("map-placeholder-backdrop")).toBeInTheDocument();
    // One Sentry report per page load, not one per remount.
    expect(sentryMock.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("restores the previous gm_authFailure handler on unmount (no leak between mounts)", async () => {
    const previous = vi.fn();
    window.gm_authFailure = previous;
    const { unmount } = await renderMap();
    expect(window.gm_authFailure).not.toBe(previous);
    unmount();
    expect(window.gm_authFailure).toBe(previous);
  });
});
