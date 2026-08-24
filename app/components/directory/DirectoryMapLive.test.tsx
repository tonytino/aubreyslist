import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { forwardRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RestaurantCardVM } from "~/components/listing/ListingCard";
import { DirectoryMapLive } from "./DirectoryMapLive";
import { CAROUSEL_BAND_PX, type DirectoryMapEntry } from "./map-ui";

/**
 * Tests for the real map path. Real Google tiles can't render in jsdom/CI, so
 * `@vis.gl/react-google-maps` is mocked at the module seam: the mock renders
 * markers' children (the accessible pin buttons) and exposes a fake
 * `google.maps.Map` with spied camera methods — asserting what matters (a11y
 * contract on pins, selection wiring, bounds fitting, the user-moved
 * heuristic, reduced-motion camera writes) without a browser.
 */

const mapMock = vi.hoisted(() => ({
  fitBounds: vi.fn(),
  moveCamera: vi.fn(),
  panTo: vi.fn(),
  panBy: vi.fn(),
  getDiv: () => ({ clientWidth: 800, clientHeight: 600 }),
  // The camera center the "Search near here" control reads, in the Maps JS
  // accessor shape (`center.lat()`).
  getCenter: () => ({ lat: () => 39.71, lng: () => -104.87 }),
}));

vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({
    children,
    onError,
  }: {
    children?: ReactNode;
    onError?: (error: unknown) => void;
  }) => (
    <>
      {/* Hook for tests to simulate the Maps JS script failing to load. */}
      <button
        type="button"
        data-testid="simulate-script-load-error"
        onClick={() => onError?.(new Error("script blocked"))}
      />
      {children}
    </>
  ),
  Map: ({
    children,
    className,
    onDragstart,
    onZoomChanged,
    onCenterChanged,
    onIdle,
  }: {
    children?: ReactNode;
    className?: string;
    onDragstart?: (event: unknown) => void;
    onZoomChanged?: (event: unknown) => void;
    onCenterChanged?: (event: unknown) => void;
    onIdle?: (event: unknown) => void;
  }) => (
    <div data-testid="google-map" className={className}>
      {/* Hooks for tests to simulate camera gestures the mock map would fire. */}
      <button type="button" data-testid="simulate-dragstart" onClick={() => onDragstart?.({})} />
      <button
        type="button"
        data-testid="simulate-zoom-changed"
        onClick={() => onZoomChanged?.({})}
      />
      <button
        type="button"
        data-testid="simulate-center-changed"
        onClick={() => onCenterChanged?.({})}
      />
      <button type="button" data-testid="simulate-idle" onClick={() => onIdle?.({})} />
      {children}
    </div>
  ),
  // forwardRef so the component's demote ref callback (tabIndex/role on the
  // marker element) is exercised against this stand-in element.
  AdvancedMarker: forwardRef<
    HTMLDivElement,
    { children?: ReactNode; zIndex?: number; onClick?: (e: unknown) => void }
  >(({ children, zIndex, onClick }, ref) => (
    <div ref={ref} data-testid="advanced-marker" data-zindex={zIndex}>
      {/* Hook for tests to simulate the marker's own gmp-click — the event
          Google's mobile gesture layer delivers instead of a DOM click on the
          marker content. Rendered only when the marker registers a handler,
          mirroring vis.gl's clickable auto-detection. tabIndex -1: a test
          hook, never part of the focus-order contract under test. */}
      {onClick ? (
        <button
          type="button"
          tabIndex={-1}
          data-testid="simulate-marker-gmp-click"
          onClick={() => onClick({})}
        />
      ) : null}
      {children}
    </div>
  )),
  AdvancedMarkerAnchorPoint: { CENTER: ["50%", "50%"] },
  useMap: () => mapMock,
}));

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
    vm: vm({ id: "b", name: "Lucia Trattoria", safetyState: "incident" }),
    lat: 39.7,
    lng: -104.9,
  },
];

// Load-failure wiring has its own tests below; everywhere else the callback
// is an inert required prop.
const noopLoadError = () => {};

function renderLive(
  selectedId: string | null = "a",
  onSearchArea?: (center: { lat: number; lng: number }) => void | Promise<void>
) {
  const onSelect = vi.fn();
  const view = render(
    <DirectoryMapLive
      apiKey="test-key"
      entries={entries}
      selectedId={selectedId}
      onSelect={onSelect}
      onLoadError={noopLoadError}
      {...(onSearchArea ? { onSearchArea } : {})}
    />
  );
  return { onSelect, view };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("DirectoryMapLive — markers", () => {
  it("renders one AdvancedMarker pin per entry with the accessible name + safety state", () => {
    renderLive();
    expect(screen.getAllByTestId("advanced-marker")).toHaveLength(2);
    // The same pin contract as the placeholder: a real, focusable <button>
    // named "restaurant, safety state" (never colour alone).
    expect(screen.getByRole("button", { name: "Root & Rye, Celiac-safe" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Lucia Trattoria, Recent incident" })
    ).toBeInTheDocument();
  });

  it("folds a recent incident into the pin's accessible name (shared construction with the fallback path)", () => {
    const withIncident: DirectoryMapEntry[] = [
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
    ];
    render(
      <DirectoryMapLive
        apiKey="test-key"
        entries={withIncident}
        selectedId="d"
        onSelect={vi.fn()}
        onLoadError={noopLoadError}
      />
    );
    // aria-label overrides button content, so the incident must live in the
    // name itself — AT hears the same safety picture sighted users see.
    expect(
      screen.getByRole("button", { name: "Harvest Table, Celiac-safe, Recent incident" })
    ).toBeInTheDocument();
  });

  it("numbers each pin by its 1-based entries order, keeping the number out of the accessible name (AUB-275)", () => {
    renderLive();
    // Same numbered-dot contract as the placeholder path (shared MapPinButton):
    // the visible content is the entries-order index, nothing else.
    const first = screen.getByRole("button", { name: "Root & Rye, Celiac-safe" });
    const second = screen.getByRole("button", { name: "Lucia Trattoria, Recent incident" });
    expect(first.textContent).toBe("1");
    expect(second.textContent).toBe("2");
    // The exact-name queries above already prove the label; assert it verbatim
    // anyway — the number is a visual correlation aid, never spoken to AT.
    expect(first.getAttribute("aria-label")).toBe("Root & Rye, Celiac-safe");
    expect(second.getAttribute("aria-label")).toBe("Lucia Trattoria, Recent incident");
  });

  it("marks the selected pin (aria-pressed) and raises its marker zIndex", () => {
    renderLive("b");
    expect(
      screen.getByRole("button", { name: "Lucia Trattoria, Recent incident" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Root & Rye, Celiac-safe" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    const markers = screen.getAllByTestId("advanced-marker");
    expect(markers.map((m) => m.getAttribute("data-zindex"))).toEqual(["1", "2"]);
  });

  it("clamps the map container at z-0 so the map subtree can never stack above the z-10 carousel", () => {
    renderLive();
    // The explicit clamp for the carousel-above-pins safety invariant — never
    // rely on Google's internal `z-index: 0` on `.gm-style`.
    expect(screen.getByTestId("google-map").className).toContain("z-0");
  });

  it("selects a restaurant when its pin is clicked (existing selectedId flow)", () => {
    const { onSelect } = renderLive("a");
    fireEvent.click(screen.getByRole("button", { name: "Lucia Trattoria, Recent incident" }));
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});

describe("DirectoryMapLive — marker-level tap wiring (AUB-285)", () => {
  it("registers an onClick on every AdvancedMarker (mobile taps never reach the inner button)", () => {
    renderLive();
    // The mock renders the gmp-click hook only when the marker receives an
    // onClick handler — its presence per marker is the wiring under test.
    expect(screen.getAllByTestId("simulate-marker-gmp-click")).toHaveLength(entries.length);
  });

  it("selects the same restaurant from a marker gmp-click as from the button's DOM click", () => {
    const { onSelect } = renderLive("a");
    const markers = screen.getAllByTestId("advanced-marker");
    const luciaMarker = markers[1] as HTMLElement;
    fireEvent.click(
      luciaMarker.querySelector('[data-testid="simulate-marker-gmp-click"]') as HTMLElement
    );
    expect(onSelect).toHaveBeenNthCalledWith(1, "b");
    // Desktop delivers the DOM click too; the duplicate onSelect with the
    // same id is a no-op re-select (pins have no tap-again behaviour).
    fireEvent.click(screen.getByRole("button", { name: "Lucia Trattoria, Recent incident" }));
    expect(onSelect).toHaveBeenNthCalledWith(2, "b");
  });

  it("demotes the marker element: tabindex -1 + role presentation, one focusable control inside", () => {
    renderLive();
    for (const marker of screen.getAllByTestId("advanced-marker")) {
      // A clickable marker element would otherwise be focusable itself,
      // doubling every stop (marker + inner button).
      expect(marker).toHaveAttribute("tabindex", "-1");
      expect(marker).toHaveAttribute("role", "presentation");
      const tabbables = within(marker)
        .getAllByRole("button")
        .filter((el) => el.tabIndex >= 0);
      // Exactly the accessible pin button — the single named, aria-pressed
      // control per marker.
      expect(tabbables).toHaveLength(1);
      expect(tabbables[0]?.getAttribute("aria-label")).toBeTruthy();
    }
  });
});

describe("DirectoryMapLive — camera fitting", () => {
  it("fits the camera to the bounds of the current pins on mount", () => {
    renderLive();
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(1);
    const [bounds] = mapMock.fitBounds.mock.calls[0] ?? [];
    expect(bounds).toEqual({ north: 39.76, south: 39.7, east: -104.9, west: -104.98 });
  });

  it("re-fits when the filtered set changes ONLY while the user hasn't moved the camera", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries}
        selectedId="a"
        onSelect={onSelect}
        onLoadError={noopLoadError}
      />
    );
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(1);

    // The visitor drags the map — the camera is theirs now.
    fireEvent.click(screen.getByTestId("simulate-dragstart"));
    const fewer = entries.slice(0, 1);
    rerender(
      <DirectoryMapLive
        apiKey="test-key"
        entries={fewer}
        selectedId="a"
        onSelect={onSelect}
        onLoadError={noopLoadError}
      />
    );
    // Filter change must not snatch the camera back.
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(1);

    // Recenter hands the camera back to the app…
    fireEvent.click(screen.getByRole("button", { name: "Recenter map" }));
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(2);
    // …and re-arms auto-refit for the next filter change.
    rerender(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries}
        selectedId="a"
        onSelect={onSelect}
        onLoadError={noopLoadError}
      />
    );
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(3);
  });

  it("treats zoom during a programmatic fit as NOT user-moved (idle re-arms, user zoom then disarms)", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries}
        selectedId="a"
        onSelect={onSelect}
        onLoadError={noopLoadError}
      />
    );
    // The mount fit itself fires zoom events — flagged programmatic, so a
    // subsequent filter change still auto-refits.
    fireEvent.click(screen.getByTestId("simulate-zoom-changed"));
    rerender(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries.slice(0, 1)}
        selectedId="a"
        onSelect={onSelect}
        onLoadError={noopLoadError}
      />
    );
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(2);

    // After the camera settles (idle), a zoom is the user's — no more refits.
    fireEvent.click(screen.getByTestId("simulate-idle"));
    fireEvent.click(screen.getByTestId("simulate-zoom-changed"));
    rerender(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries}
        selectedId="a"
        onSelect={onSelect}
        onLoadError={noopLoadError}
      />
    );
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(2);
  });

  it("pans to a newly selected entry at the current zoom (no fit, no zoom write)", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries}
        selectedId="a"
        onSelect={onSelect}
        onLoadError={noopLoadError}
      />
    );
    // Mount: bounds fit only — the initial selection must never pan.
    expect(mapMock.panTo).not.toHaveBeenCalled();
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(1);

    // The user selects the other pin/mini-card → the camera pans to it, then
    // shifts down half the carousel band so the pin centres in the visible
    // canvas above the band instead of the raw canvas.
    rerender(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries}
        selectedId="b"
        onSelect={onSelect}
        onLoadError={noopLoadError}
      />
    );
    expect(mapMock.panTo).toHaveBeenCalledTimes(1);
    expect(mapMock.panTo).toHaveBeenCalledWith({ lat: 39.7, lng: -104.9 });
    expect(mapMock.panBy).toHaveBeenCalledTimes(1);
    expect(mapMock.panBy).toHaveBeenCalledWith(0, CAROUSEL_BAND_PX / 2);
    // A pan is never a re-fit and never a zoom change.
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(1);
    expect(mapMock.moveCamera).not.toHaveBeenCalled();
  });

  it("does NOT pan on the route's validity reassign, and the pan never disarms refit-on-filter-change", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries}
        selectedId="a"
        onSelect={onSelect}
        onLoadError={noopLoadError}
      />
    );
    // A real user selection pans…
    rerender(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries}
        selectedId="b"
        onSelect={onSelect}
        onLoadError={noopLoadError}
      />
    );
    expect(mapMock.panTo).toHaveBeenCalledTimes(1);

    // …then a filter change drops the selected entry and the route reassigns
    // the selection to the first survivor. That's not a user selection: the
    // refit frames the new result set (the pan must not snatch the camera),
    // and the earlier pan must not have flipped the user-moved flag.
    const fewer = entries.slice(0, 1);
    rerender(
      <DirectoryMapLive
        apiKey="test-key"
        entries={fewer}
        selectedId="a"
        onSelect={onSelect}
        onLoadError={noopLoadError}
      />
    );
    expect(mapMock.panTo).toHaveBeenCalledTimes(1);
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(2);
  });

  it("does NOT pan when the first selection arrives after mount (initial auto-select)", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries}
        selectedId={null}
        onSelect={onSelect}
        onLoadError={noopLoadError}
      />
    );
    // The route's auto-select-first lands post-mount — still the initial
    // selection, so the bounds fit stands and no pan fires.
    rerender(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries}
        selectedId="a"
        onSelect={onSelect}
        onLoadError={noopLoadError}
      />
    );
    expect(mapMock.panTo).not.toHaveBeenCalled();
  });

  it("pans with an INSTANT moveCamera (center only, zoom untouched) under prefers-reduced-motion", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries}
        selectedId="a"
        onSelect={onSelect}
        onLoadError={noopLoadError}
      />
    );
    mapMock.moveCamera.mockClear();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true } as unknown as MediaQueryList)
    );

    rerender(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries}
        selectedId="b"
        onSelect={onSelect}
        onLoadError={noopLoadError}
      />
    );
    expect(mapMock.panTo).not.toHaveBeenCalled();
    expect(mapMock.panBy).not.toHaveBeenCalled();
    // Center-only camera write: the selection pan never changes zoom.
    expect(mapMock.moveCamera).toHaveBeenCalledTimes(1);
    expect(mapMock.moveCamera).toHaveBeenCalledWith({ center: { lat: 39.7, lng: -104.9 } });
  });

  it("recenters with an INSTANT moveCamera (never-animated) under prefers-reduced-motion", () => {
    renderLive();
    mapMock.fitBounds.mockClear();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true } as unknown as MediaQueryList)
    );

    fireEvent.click(screen.getByRole("button", { name: "Recenter map" }));
    expect(mapMock.fitBounds).not.toHaveBeenCalled();
    expect(mapMock.moveCamera).toHaveBeenCalledTimes(1);
    const [camera] = mapMock.moveCamera.mock.calls[0] ?? [];
    expect(camera).toMatchObject({
      center: { lat: expect.any(Number), lng: expect.any(Number) },
      zoom: expect.any(Number),
    });
  });
});

describe("DirectoryMapLive — search near here (AUB-284)", () => {
  it("shows the pill only after the visitor moves the camera", () => {
    renderLive("a", vi.fn());
    expect(screen.queryByRole("button", { name: "Search near here" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("simulate-dragstart"));
    expect(screen.getByRole("button", { name: "Search near here" })).toBeInTheDocument();
  });

  it("never shows the pill when no onSearchArea is wired, even after movement", () => {
    renderLive("a");
    fireEvent.click(screen.getByTestId("simulate-dragstart"));
    expect(screen.queryByRole("button", { name: "Search near here" })).not.toBeInTheDocument();
  });

  it("ignores programmatic zooms; a user zoom after the camera settles surfaces the pill", () => {
    renderLive("a", vi.fn());
    // Camera events before the first idle are the mount fit's own — not the
    // user.
    fireEvent.click(screen.getByTestId("simulate-zoom-changed"));
    expect(screen.queryByRole("button", { name: "Search near here" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("simulate-idle"));
    fireEvent.click(screen.getByTestId("simulate-zoom-changed"));
    expect(screen.getByRole("button", { name: "Search near here" })).toBeInTheDocument();
  });

  it("treats a settled center change (keyboard pan) as a user gesture, but never a programmatic one", () => {
    renderLive("a", vi.fn());
    // Before idle: the initial camera write's own center events don't count.
    fireEvent.click(screen.getByTestId("simulate-center-changed"));
    expect(screen.queryByRole("button", { name: "Search near here" })).not.toBeInTheDocument();
    // After idle, a center change is the user's — arrow-key pans fire no
    // dragstart, so this is their path to the pill.
    fireEvent.click(screen.getByTestId("simulate-idle"));
    fireEvent.click(screen.getByTestId("simulate-center-changed"));
    expect(screen.getByRole("button", { name: "Search near here" })).toBeInTheDocument();
  });

  it("does not surface the pill from a selection pan's center events", () => {
    const onSelect = vi.fn();
    const onSearchArea = vi.fn();
    const { rerender } = render(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries}
        selectedId="a"
        onSelect={onSelect}
        onLoadError={noopLoadError}
        onSearchArea={onSearchArea}
      />
    );
    fireEvent.click(screen.getByTestId("simulate-idle"));
    // A pin tap pans the camera (PanToSelection flags it programmatic); the
    // pan's center events must not read as the user framing an area.
    rerender(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries}
        selectedId="b"
        onSelect={onSelect}
        onLoadError={noopLoadError}
        onSearchArea={onSearchArea}
      />
    );
    expect(mapMock.panTo).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("simulate-center-changed"));
    expect(screen.queryByRole("button", { name: "Search near here" })).not.toBeInTheDocument();
  });

  it("hands the current map center to onSearchArea, shows the busy state, then hides on success", async () => {
    let resolveSearch!: () => void;
    const onSearchArea = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSearch = resolve;
        })
    );
    renderLive("a", onSearchArea);
    fireEvent.click(screen.getByTestId("simulate-dragstart"));
    const pill = screen.getByRole("button", { name: "Search near here" });
    pill.focus();
    fireEvent.click(pill);
    // The center comes from the live camera (map.getCenter), not from any pin.
    expect(onSearchArea).toHaveBeenCalledTimes(1);
    expect(onSearchArea).toHaveBeenCalledWith({ lat: 39.71, lng: -104.87 });
    // Busy: aria-disabled + aria-busy, never `disabled` — focus stays on the
    // control — and a second click cannot double-fire.
    const busy = screen.getByRole("button", { name: "Searching…" });
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(document.activeElement).toBe(busy);
    fireEvent.click(busy);
    expect(onSearchArea).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSearch();
    });
    expect(
      screen.queryByRole("button", { name: /Search near here|Searching…/ })
    ).not.toBeInTheDocument();
  });

  it("keeps the pill mounted for a retry when the search fails", async () => {
    let rejectSearch!: (error: Error) => void;
    const onSearchArea = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSearch = reject;
        })
    );
    renderLive("a", onSearchArea);
    fireEvent.click(screen.getByTestId("simulate-dragstart"));
    fireEvent.click(screen.getByRole("button", { name: "Search near here" }));
    await act(async () => {
      rejectSearch(new Error("offline"));
    });
    // Failure: busy clears, the pill stays as its own retry (the route's
    // status region announces the failure), and nothing rejects unhandled.
    const pill = screen.getByRole("button", { name: "Search near here" });
    expect(pill).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(pill);
    expect(onSearchArea).toHaveBeenCalledTimes(2);
  });

  it("keeps the camera where the visitor framed it when the searched area's results land", async () => {
    let resolveSearch!: () => void;
    const onSearchArea = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSearch = resolve;
        })
    );
    const onSelect = vi.fn();
    const { rerender } = render(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries}
        selectedId="a"
        onSelect={onSelect}
        onLoadError={noopLoadError}
        onSearchArea={onSearchArea}
      />
    );
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("simulate-dragstart"));
    fireEvent.click(screen.getByRole("button", { name: "Search near here" }));
    await act(async () => {
      resolveSearch();
    });
    // The new area's result set arrives as new entries…
    rerender(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries.slice(0, 1)}
        selectedId="a"
        onSelect={onSelect}
        onLoadError={noopLoadError}
        onSearchArea={onSearchArea}
      />
    );
    // …and the user-moved heuristic keeps the refit suppressed: the visitor
    // framed this view, so the camera must not jump to the new pins.
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(1);
    expect(mapMock.moveCamera).not.toHaveBeenCalled();
    // The pill stays hidden until the camera moves again.
    expect(screen.queryByRole("button", { name: "Search near here" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("simulate-dragstart"));
    expect(screen.getByRole("button", { name: "Search near here" })).toBeInTheDocument();
  });

  it("drops the pill when the recenter FAB hands the camera back", () => {
    renderLive("a", vi.fn());
    fireEvent.click(screen.getByTestId("simulate-dragstart"));
    expect(screen.getByRole("button", { name: "Search near here" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recenter map" }));
    expect(screen.queryByRole("button", { name: "Search near here" })).not.toBeInTheDocument();
  });

  it("stacks between the map canvas and the carousel band (z-order safety invariant)", () => {
    renderLive("a", vi.fn());
    fireEvent.click(screen.getByTestId("simulate-dragstart"));
    const pill = screen.getByRole("button", { name: "Search near here" });
    // Above the z-0-clamped canvas, below the z-10 carousel: a safety chip on
    // a mini-card can never end up under this pill.
    expect(pill.className).toContain("z-[5]");
  });
});

describe("DirectoryMapLive — script-load failure (AUB-281)", () => {
  it("wires APIProvider's onError to the onLoadError callback with the failure cause", () => {
    const onLoadError = vi.fn();
    render(
      <DirectoryMapLive
        apiKey="test-key"
        entries={entries}
        selectedId="a"
        onSelect={vi.fn()}
        onLoadError={onLoadError}
      />
    );
    fireEvent.click(screen.getByTestId("simulate-script-load-error"));
    // DirectoryMap funnels this into the placeholder fallback; here we assert
    // only the wiring: one call, cause naming the load failure.
    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(onLoadError).toHaveBeenCalledWith(expect.stringContaining("script blocked"));
  });
});
