import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
    unmount: () => view.unmount(),
    rerenderWith: (sel: string | null, ents: readonly DirectoryMapEntry[] = entries) =>
      view.rerender(ui(sel, ents)),
  };
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

  it("gives the unattested pin a glyph distinct from the celiac-safe shield (greyscale-survivable)", () => {
    renderMap();
    const pinOf = (name: string) =>
      screen
        .getAllByRole("button", { name })
        .find((el) => el.className.includes("size-11")) as HTMLElement;
    // A shield outline at dot size would read celiac-safe under greyscale/CVD;
    // the unattested pin must carry the dashed "unknown" ring instead.
    const unattested = pinOf("New Spot, Not yet attested");
    expect(unattested.querySelector("svg.lucide-circle-dashed")).toBeInTheDocument();
    expect(unattested.querySelector("svg.lucide-shield-check")).not.toBeInTheDocument();
    expect(
      pinOf("Root & Rye, Celiac-safe").querySelector("svg.lucide-shield-check")
    ).toBeInTheDocument();
  });

  it("expands only the selected pin into a name pill — unselected pins stay nameless dots", () => {
    renderMap("b");
    const pinOf = (name: string) =>
      screen
        .getAllByRole("button", { name })
        .find((el) => el.className.includes("size-11")) as HTMLElement;
    // The selected pill shows the truncated name; the ring is the selected
    // affordance.
    const selectedName = within(pinOf("Lucia Trattoria, Recent incident")).getByText(
      "Lucia Trattoria"
    );
    expect(selectedName.className).toContain("max-w-[10rem]");
    expect(selectedName.className).toContain("truncate");
    // An unselected pin keeps its name span collapsed + invisible (zero-width
    // dot) and never scales.
    const unselectedName = within(pinOf("Root & Rye, Celiac-safe")).getByText("Root & Rye");
    expect(unselectedName.className).toContain("max-w-0");
    expect(unselectedName.className).toContain("opacity-0");
    const unselectedDot = pinOf("Root & Rye, Celiac-safe").querySelector("span") as HTMLElement;
    expect(unselectedDot.className).not.toContain("scale-125");
  });

  it("hides the pill's visible name from AT — it duplicates the accessible name", () => {
    renderMap("b");
    const pin = screen
      .getAllByRole("button", { name: "Lucia Trattoria, Recent incident" })
      .find((el) => el.className.includes("size-11")) as HTMLElement;
    // aria-label already carries name + safety state; content text would
    // double-announce, so the pill text is aria-hidden.
    expect(within(pin).getByText("Lucia Trattoria")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the pill unconditionally when selected — only the expansion transition is motion-gated", () => {
    renderMap("b");
    const pin = screen
      .getAllByRole("button", { name: "Lucia Trattoria, Recent incident" })
      .find((el) => el.className.includes("size-11")) as HTMLElement;
    const dot = pin.querySelector("span") as HTMLElement;
    const name = within(pin).getByText("Lucia Trattoria");
    // Reduced-motion users must still get the full pill (name + padding),
    // instantly: the expanded state carries no motion-safe prefix…
    expect(name.className).toContain("max-w-[10rem]");
    expect(name.className).not.toContain("motion-safe:max-w-[10rem]");
    // …while every animated property is motion-safe-gated, so nothing
    // transitions under prefers-reduced-motion.
    expect(name.className).toContain("motion-safe:transition-[max-width,opacity,padding]");
    expect(dot.className).toContain("motion-safe:transition-[padding]");
    expect(dot.className).not.toMatch(/(^|\s)transition/);
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

  it("renders the live path, not the placeholder, when a key is provisioned", () => {
    renderMap();
    expect(screen.getByTestId("live-map-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("map-placeholder-backdrop")).not.toBeInTheDocument();
  });

  it("degrades to the placeholder WITH the carousel intact when the live map throws during render", () => {
    liveMapMock.throwOnRender = true;
    // React logs boundary-caught errors and the fail handler warns — both
    // expected here, neither useful as test noise.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    renderMap();
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

  it("degrades to the placeholder when Google rejects the key (window.gm_authFailure)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    renderMap();
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

  it("latches the failure for the whole page load: a remount starts on the placeholder", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { unmount } = renderMap();
    act(() => {
      window.gm_authFailure?.();
    });
    unmount();
    // Maps can't recover without a reload and gm_authFailure never fires
    // twice, so the List→Map toggle's remount must not retry the live path.
    renderMap();
    expect(screen.queryByTestId("live-map-stub")).not.toBeInTheDocument();
    expect(screen.getByTestId("map-placeholder-backdrop")).toBeInTheDocument();
    // One Sentry report per page load, not one per remount.
    expect(sentryMock.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("restores the previous gm_authFailure handler on unmount (no leak between mounts)", () => {
    const previous = vi.fn();
    window.gm_authFailure = previous;
    const { unmount } = renderMap();
    expect(window.gm_authFailure).not.toBe(previous);
    unmount();
    expect(window.gm_authFailure).toBe(previous);
  });
});
