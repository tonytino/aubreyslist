import * as Sentry from "@sentry/tanstackstart-react";
import { Component, memo, type ReactNode, useCallback, useEffect, useState } from "react";
import { DirectoryMapLive } from "~/components/directory/DirectoryMapLive";
import { projectToMap } from "~/components/directory/map-projection";
import {
  type DirectoryMapEntry,
  MapCarousel,
  MapPinButton,
  RecenterFab,
} from "~/components/directory/map-ui";
import { googleMapsBrowserKey } from "~/lib/public-env";
import type { Coords } from "~/listings/distance";
import type { MapLoadMore } from "~/listings/use-map-pages";

/**
 * The directory Map view. Two render paths behind one public component:
 *
 * - **Real map** (`DirectoryMapLive.tsx`) — when the public,
 *   referrer-restricted `VITE_GOOGLE_MAPS_BROWSER_KEY` is provisioned, a
 *   Google map via `@vis.gl/react-google-maps` with `<AdvancedMarker>` pins at
 *   true lat/lng.
 * - **CSS-placeholder fallback** (this file) — when the key is absent/blank
 *   (local dev, CI, E2E, un-provisioned deploys), a stylized view: a CSS
 *   backdrop (grid + park/water blobs) with pins projected from each
 *   listing's real `lat`/`lng` via a fixed metro-Denver bounding box
 *   (`projectToMap`), and the recenter FAB present but unwired.
 *
 * Fallback-on-failure: a provisioned key does not guarantee a working map —
 * Google can reject the key after the script loads (e.g.
 * `RefererNotAllowedMapError` on a preview host outside the key's referrer
 * allowlist), leaving the Maps runtime half-initialized so vis.gl marker
 * internals throw during render. Three failure signals funnel into one
 * handler that flips the view to the placeholder: `window.gm_authFailure`
 * (auth/referrer rejection), a local error boundary around only the live map
 * (render throws), and `APIProvider`'s `onError` (script-load/CSP failure).
 * The degrade is silent for users — the placeholder is a designed surface and
 * pins/carousel/selection keep working — but never for operators: the handler
 * reports every failure to Sentry, since the boundary keeps a live-map crash
 * from ever reaching `RootErrorBoundary`'s capture (and from unmounting the
 * whole route, the carousel included).
 *
 * Both paths share the same pin visuals, accessible names, and the bottom
 * mini-card carousel (`map-ui.tsx`), so the safety-signal contract and the
 * carousel-above-pins invariant below hold identically in both.
 *
 * Safety-correctness invariant: a pin carries a safety signal (colour + icon +
 * label), so a pin must never visually float over a different restaurant's
 * card — a mis-associated safety signal is a real harm (e.g. a red incident
 * pin bleeding onto a celiac-safe card). Enforced two ways: the carousel sits
 * at `z-10` above the pins (`z-1`/`z-6` here; the whole map canvas in the live
 * path) and draws an opaque background band, so any low pin hides behind the
 * band instead of over a card.
 *
 * Accessibility: every pin and mini-card is a real `<button>`; the pin's
 * visible content (the numbered-pins variant's index number) is decorative
 * and its accessible name is the restaurant name + its safety state, so the
 * safety meaning is never colour-only. The selected pin/mini-card carry
 * `aria-pressed` in addition to the visual ring/border.
 */

export type { DirectoryMapEntry };

declare global {
  interface Window {
    /**
     * Google Maps JS's documented auth-failure hook (not in
     * `@types/google.maps`): called at most once per page load, asynchronously
     * after the script loads, when the key is rejected (e.g.
     * RefererNotAllowedMapError). A future `@vis.gl/react-google-maps` may
     * claim this global itself (1.9.0 ships a dead `AUTH_FAILURE` branch) —
     * when upgrading, check whether `useApiLoadingStatus() === AUTH_FAILURE`
     * has become the durable signal and retire the manual hook here.
     */
    gm_authFailure?: (() => void) | undefined;
  }
}

// Module-level latch, deliberately outside component state: Google Maps
// cannot recover a rejected key or failed script without a full page reload,
// and `gm_authFailure` never fires a second time — so once the live map has
// failed, a later remount (e.g. the List→Map view toggle) must start on the
// placeholder rather than retry, blank-or-crash again, and re-report to
// Sentry on every toggle. Mirrors vis.gl's own module-level loading-status
// singleton. Cleared only by tests.
let liveMapFailedThisPageLoad = false;

/** Test-only seam: clears the module-level failure latch between tests. */
export function resetLiveMapFailureLatch() {
  liveMapFailedThisPageLoad = false;
}

/** The route-owned area-search lifecycle, announced by the status region. */
export type AreaSearchStatus = "idle" | "pending" | "failed";

/**
 * What the map view's polite status region says. One always-mounted region
 * (the `<output>` below) carries every async outcome — loading more, an
 * area search, either one failing — so screen-reader users hear the same
 * progress sighted users watch on the card/pill. Busy states first, then the
 * honest count of what is showing.
 */
function mapStatusText(
  count: number,
  loadMore: MapLoadMore | undefined,
  areaSearch: AreaSearchStatus
): string {
  if (loadMore?.pending) return "Loading more places…";
  if (loadMore?.failed) return "Couldn't load more places. Try again.";
  if (areaSearch === "pending") return "Searching near here…";
  if (areaSearch === "failed") return "Search failed. Try again.";
  return count === 1 ? "Showing 1 place" : `Showing ${count} places`;
}

/**
 * Memoized: the browse route re-renders on every search keystroke, and
 * without the bail-out each keystroke would re-render every pin/marker (and,
 * on the live path, re-run vis.gl's per-marker effects). All props are
 * stable-by-construction at the call site — memoized entries/loadMore,
 * useCallback handlers, setState setters.
 */
export const DirectoryMap = memo(function DirectoryMap({
  entries,
  selectedId,
  onSelect,
  loadMore,
  onSearchArea,
  areaSearchStatus = "idle",
  restoreSelectedId,
  resultSetPending,
}: {
  entries: readonly DirectoryMapEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Carousel "Load more" wiring — shared by both render paths. */
  loadMore?: MapLoadMore;
  /** The URL-restored selection to scroll the carousel to instantly on
   * mount (see `MapCarousel`). */
  restoreSelectedId?: string | null;
  /** True while the entries may still be replaced without a navigation
   * (the distance anchor resolving) — the restore's settle signal. */
  resultSetPending?: boolean;
  /**
   * Re-run the browse anchored on the given map center ("Search near here").
   * Live path only: the placeholder has no camera, so it never surfaces the
   * button.
   */
  onSearchArea?: (center: Coords) => void | Promise<void>;
  /** The area search's lifecycle, for the status region's announcements. */
  areaSearchStatus?: AreaSearchStatus;
}) {
  // Public, compile-time key (see app/lib/public-env.ts). Absent → the
  // deterministic CSS-placeholder fallback, so the view (and CI/E2E) never
  // depends on key provisioning or Google availability.
  const apiKey = googleMapsBrowserKey();

  // Key present but the live map failed (auth rejection, script-load failure,
  // or a render crash) → same placeholder path. Seeded from the module latch
  // so a remount after a failure starts on the placeholder directly.
  const [liveMapFailed, setLiveMapFailed] = useState(() => liveMapFailedThisPageLoad);
  const onLiveMapFail = useCallback((cause: string, error?: unknown) => {
    liveMapFailedThisPageLoad = true;
    // Silent degrade for users, never for operators: the local boundary keeps
    // failures from reaching RootErrorBoundary's Sentry capture, so report
    // here — the original throw when there is one, a message for the
    // signal-only failures (auth rejection, script load).
    if (error === undefined) {
      Sentry.captureMessage(`Live Google map unavailable (${cause})`, "warning");
    } else {
      Sentry.captureException(error);
    }
    console.warn(`Live Google map unavailable (${cause}); showing the placeholder map instead.`);
    setLiveMapFailed(true);
  }, []);

  const liveMapActive = apiKey !== null && !liveMapFailed;

  // Google's auth-failure hook is a bare window global, so own it only while
  // the live path is mounted and restore whatever was there on cleanup.
  useEffect(() => {
    if (!liveMapActive || typeof window === "undefined") return;
    const previous = window.gm_authFailure;
    window.gm_authFailure = () => onLiveMapFail("Google rejected the Maps key for this referrer");
    return () => {
      window.gm_authFailure = previous;
    };
  }, [liveMapActive, onLiveMapFail]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      {liveMapActive ? (
        <LiveMapErrorBoundary onFail={onLiveMapFail}>
          <DirectoryMapLive
            apiKey={apiKey}
            entries={entries}
            selectedId={selectedId}
            onSelect={onSelect}
            onLoadError={onLiveMapFail}
            {...(onSearchArea ? { onSearchArea } : {})}
          />
        </LiveMapErrorBoundary>
      ) : (
        <PlaceholderMap entries={entries} selectedId={selectedId} onSelect={onSelect} />
      )}

      {/* Bottom carousel — must sit above the pins with an opaque band so a low
          pin can never bleed over a mini-card (safety-correctness; see
          map-ui.tsx). Shared verbatim by both map paths. */}
      <MapCarousel
        entries={entries}
        selectedId={selectedId}
        onSelect={onSelect}
        {...(loadMore ? { loadMore } : {})}
        {...(restoreSelectedId ? { restoreSelectedId } : {})}
        {...(resultSetPending !== undefined ? { resultSetPending } : {})}
      />

      {/* The map view's one polite status region. Always mounted with only
          its text swapped (a live region inserted together with its content
          is commonly not announced); sr-only because sighted users get the
          same states from the card/pill/pins themselves. */}
      <output className="sr-only">
        {mapStatusText(entries.length, loadMore, areaSearchStatus)}
      </output>
    </div>
  );
});

/**
 * Local error boundary around only the live map (never the carousel): a
 * half-initialized Maps runtime makes vis.gl marker internals throw during
 * render, and without this boundary that throw would bubble to the root
 * `errorComponent` and replace the whole browse route. A class component
 * because that's the only React mechanism that catches render throws. On
 * catch it defers to the parent's fail handler, passing the original throw
 * along for Sentry — the parent flips to `PlaceholderMap`, keeping the path
 * switch and the reporting in one place — and renders nothing while it waits
 * for that state flip to unmount it.
 */
class LiveMapErrorBoundary extends Component<
  { onFail: (cause: string, error: unknown) => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onFail(`the live map crashed while rendering: ${error.message}`, error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The key-absent fallback: a stylized placeholder — decorative backdrop +
 * `projectToMap`-projected pins + an unwired recenter FAB. Kept deliberately
 * so keyless environments (CI, E2E, local dev) stay deterministic.
 */
function PlaceholderMap({
  entries,
  selectedId,
  onSelect,
}: {
  entries: readonly DirectoryMapEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {/* Stylized backdrop: two soft blobs (park/water) + a faint grid.
          Decorative only — the real map renders in DirectoryMapLive instead. */}
      <div
        aria-hidden="true"
        data-testid="map-placeholder-backdrop"
        className="absolute inset-0 bg-[radial-gradient(circle_at_72%_24%,var(--color-accent-mint)_0_62px,transparent_63px),radial-gradient(circle_at_16%_78%,var(--color-accent-sky)_0_74px,transparent_75px),repeating-linear-gradient(0deg,var(--color-border)_0_1.5px,transparent_1.5px_48px),repeating-linear-gradient(90deg,var(--color-border)_0_1.5px,transparent_1.5px_48px)] bg-background"
      />

      {/* Pins — projected from real lat/lng. Each is an accessible button whose
          name carries the restaurant + its safety state (never colour alone). */}
      <ul className="absolute inset-0 list-none">
        {entries.map(({ vm, lat, lng }, entryIndex) => {
          const { left, top } = projectToMap(lat, lng);
          const selected = vm.id === selectedId;
          return (
            <li key={vm.id}>
              <MapPinButton
                vm={vm}
                // 1-based entries-order index — matches the carousel card's
                // chip because both map over the same `entries` array.
                index={entryIndex + 1}
                selected={selected}
                onSelect={onSelect}
                // Runtime-computed left/top from the projection — the sanctioned
                // inline-style exception (dynamic positioning).
                style={{ left: `${left}%`, top: `${top}%` }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 ${
                  selected ? "z-[6]" : "z-[1]"
                }`}
              />
            </li>
          );
        })}
      </ul>

      {/* Recenter FAB — present but unwired in the fallback (a real recentre
          needs a real camera; see DirectoryMapLive). */}
      <RecenterFab />
    </>
  );
}
