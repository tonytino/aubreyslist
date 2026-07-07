import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RestaurantCardVM } from "~/components/listing/ListingCard";
import { DirectoryMapLive } from "./DirectoryMapLive";
import type { DirectoryMapEntry } from "./map-ui";

/**
 * Tests for the REAL map path (AUB-111). Real Google tiles can't render in
 * jsdom/CI, so `@vis.gl/react-google-maps` is mocked at the module seam: the
 * mock renders markers' children (our accessible pin buttons) and exposes a
 * fake `google.maps.Map` with spied camera methods — letting us assert the
 * things that matter (a11y contract on pins, selection wiring, bounds fitting,
 * the user-moved heuristic, reduced-motion camera writes) without a browser.
 */

const mapMock = vi.hoisted(() => ({
  fitBounds: vi.fn(),
  moveCamera: vi.fn(),
  getDiv: () => ({ clientWidth: 800, clientHeight: 600 }),
}));

vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Map: ({
    children,
    className,
    onDragstart,
    onZoomChanged,
    onIdle,
  }: {
    children?: ReactNode;
    className?: string;
    onDragstart?: (event: unknown) => void;
    onZoomChanged?: (event: unknown) => void;
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
      <button type="button" data-testid="simulate-idle" onClick={() => onIdle?.({})} />
      {children}
    </div>
  ),
  AdvancedMarker: ({ children, zIndex }: { children?: ReactNode; zIndex?: number }) => (
    <div data-testid="advanced-marker" data-zindex={zIndex}>
      {children}
    </div>
  ),
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

function renderLive(selectedId: string | null = "a") {
  const onSelect = vi.fn();
  const view = render(
    <DirectoryMapLive
      apiKey="test-key"
      entries={entries}
      selectedId={selectedId}
      onSelect={onSelect}
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
    // The SAME pin contract as the placeholder: a real, focusable <button>
    // named "restaurant, safety state" (never colour alone).
    expect(screen.getByRole("button", { name: "Root & Rye, Celiac-safe" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Lucia Trattoria, Recent incident" })
    ).toBeInTheDocument();
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
    // The explicit clamp for the carousel-above-pins safety invariant — we do
    // not rely on Google's internal `z-index: 0` on `.gm-style`.
    expect(screen.getByTestId("google-map").className).toContain("z-0");
  });

  it("selects a restaurant when its pin is clicked (existing selectedId flow)", () => {
    const { onSelect } = renderLive("a");
    fireEvent.click(screen.getByRole("button", { name: "Lucia Trattoria, Recent incident" }));
    expect(onSelect).toHaveBeenCalledWith("b");
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
      <DirectoryMapLive apiKey="test-key" entries={entries} selectedId="a" onSelect={onSelect} />
    );
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(1);

    // The visitor drags the map — the camera is theirs now.
    fireEvent.click(screen.getByTestId("simulate-dragstart"));
    const fewer = entries.slice(0, 1);
    rerender(
      <DirectoryMapLive apiKey="test-key" entries={fewer} selectedId="a" onSelect={onSelect} />
    );
    // Filter change must NOT snatch the camera back.
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(1);

    // Recenter hands the camera back to the app…
    fireEvent.click(screen.getByRole("button", { name: "Recenter map" }));
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(2);
    // …and re-arms auto-refit for the next filter change.
    rerender(
      <DirectoryMapLive apiKey="test-key" entries={entries} selectedId="a" onSelect={onSelect} />
    );
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(3);
  });

  it("treats zoom during a programmatic fit as NOT user-moved (idle re-arms, user zoom then disarms)", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <DirectoryMapLive apiKey="test-key" entries={entries} selectedId="a" onSelect={onSelect} />
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
      />
    );
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(2);

    // After the camera settles (idle), a zoom is the USER's — no more refits.
    fireEvent.click(screen.getByTestId("simulate-idle"));
    fireEvent.click(screen.getByTestId("simulate-zoom-changed"));
    rerender(
      <DirectoryMapLive apiKey="test-key" entries={entries} selectedId="a" onSelect={onSelect} />
    );
    expect(mapMock.fitBounds).toHaveBeenCalledTimes(2);
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
