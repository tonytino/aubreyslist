import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  APIProvider,
  Map as GoogleMap,
  useMap,
} from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  boundsForEntries,
  cameraForBounds,
  type MapBounds,
  type MapPadding,
} from "~/components/directory/map-camera";
import {
  CAROUSEL_BAND_PX,
  type DirectoryMapEntry,
  MapPinButton,
  RecenterFab,
  useUserSelectionChange,
} from "~/components/directory/map-ui";
import { prefersReducedMotion } from "~/lib/motion";

/**
 * The real directory map: Google Maps via `@vis.gl/react-google-maps`
 * (Google's endorsed React library), rendered only when the public,
 * referrer-restricted `VITE_GOOGLE_MAPS_BROWSER_KEY` is provisioned — the
 * key-absent fallback lives in `DirectoryMap.tsx`, which also degrades to
 * that same placeholder when the live map fails: `onLoadError` (wired to
 * `APIProvider`'s `onError` below) reports script-load/CSP failure, while
 * auth rejection (`window.gm_authFailure`) and render crashes are caught by
 * `DirectoryMap` itself.
 *
 * - **Pins** are `<AdvancedMarker>`s at each listing's true lat/lng, rendering
 *   the same `MapPinButton` as the placeholder (safety colour + the
 *   entries-order index number of the numbered-pins variant + an accessible
 *   "name, safety state" label; keyboard-focusable real `<button>`;
 *   selected ring + `aria-pressed`) — the safety-signal contract is shared,
 *   not duplicated. The selected pin gets a higher marker `zIndex`.
 * - **Camera**: initial view fits the bounds of the current result pins
 *   (`defaultBounds` + padding so pins clear the opaque carousel band); when
 *   the filtered set changes the camera re-fits only if the visitor hasn't
 *   moved it themselves (drag / non-programmatic zoom sets a "user moved"
 *   flag). The recenter FAB re-fits on demand and clears that flag. Selecting
 *   a pin/mini-card pans the camera to that entry at the current zoom
 *   (`PanToSelection`) — never on mount or when the route's validity guard
 *   reassigns the selection after a filter change, so the pan never fights
 *   the refit-unless-user-moved logic.
 * - **Reduced motion**: every programmatic fit or pan checks
 *   `prefers-reduced-motion`; when reduced, the camera jumps via the
 *   never-animated `map.moveCamera` (camera computed by the pure
 *   `cameraForBounds`, or the entry's centre for a selection pan) instead of
 *   `fitBounds`/`panTo`, which may animate.
 * - **Z-order safety invariant** (see `map-ui.tsx`): everything here renders
 *   below the opaque `z-10` carousel band that `DirectoryMap` stacks after it.
 *   Never rely on Google's internal `z-index: 0` on `.gm-style`: the map
 *   container carries an explicit `z-0` clamp, which pins the positioned
 *   container at z-index 0 and gives it its own stacking context — so no
 *   marker or Google-internal element can ever stack above the carousel,
 *   regardless of Maps internals.
 *
 * `mapId` is Google's documented `DEMO_MAP_ID` sentinel: Advanced Markers
 * require a map ID, and the demo ID enables them (vector map, default styling)
 * with no console errors and no cloud-console setup. Swapping in a real
 * cloud-styled map ID later is a one-constant change.
 */

const DIRECTORY_MAP_ID = "DEMO_MAP_ID";

/**
 * Pixel padding for every bounds fit: on the bottom, the opaque mini-card
 * carousel band plus headroom so pins clear it instead of hiding behind it;
 * breathing room elsewhere so edge pins aren't glued to the viewport.
 */
const FIT_PADDING: MapPadding = { top: 48, right: 48, bottom: CAROUSEL_BAND_PX + 44, left: 48 };

/**
 * Fit the camera to `bounds`, honouring reduced motion: `fitBounds` (may
 * animate) normally, or an instant `moveCamera` to the equivalent camera
 * (computed by the pure `cameraForBounds` from the canvas size) when reduced.
 * Flags the move as programmatic so the zoom events it fires aren't mistaken
 * for the user moving the camera.
 */
function fitMapToBounds(
  map: google.maps.Map,
  bounds: MapBounds,
  programmaticMove: { current: boolean }
): void {
  programmaticMove.current = true;
  if (prefersReducedMotion()) {
    const div = map.getDiv();
    map.moveCamera(
      cameraForBounds(bounds, { width: div.clientWidth, height: div.clientHeight }, FIT_PADDING)
    );
  } else {
    map.fitBounds(bounds, FIT_PADDING);
  }
}

/**
 * The app's class-based dark mode (`.dark` on `<html>`, see
 * docs/agents/styling.md) → the Maps `colorScheme`. SSR/first paint renders
 * light and reconciles after mount (same SSR-safe pattern as ThemeToggle);
 * a MutationObserver follows later toggles. Changing `colorScheme` recreates
 * the map instance — acceptable for a rare, explicit theme flip.
 */
function useMapColorScheme(): "DARK" | "LIGHT" {
  const [scheme, setScheme] = useState<"DARK" | "LIGHT">("LIGHT");
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setScheme(root.classList.contains("dark") ? "DARK" : "LIGHT");
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return scheme;
}

export function DirectoryMapLive({
  apiKey,
  entries,
  selectedId,
  onSelect,
  onLoadError,
}: {
  apiKey: string;
  entries: readonly DirectoryMapEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The Maps JS script failed to load (network/CSP) — see the module doc. */
  onLoadError: (cause: string) => void;
}) {
  const colorScheme = useMapColorScheme();
  const bounds = useMemo(() => boundsForEntries(entries), [entries]);

  // "User moved the camera" heuristic (simple by design): a drag start, or a
  // zoom change that we didn't cause programmatically, marks the camera as
  // user-owned — after which filter changes stop re-fitting until the visitor
  // taps the recenter FAB (which resets the flag). Refs, not state: these must
  // never re-render the map.
  const userMoved = useRef(false);
  const programmaticMove = useRef(false);

  return (
    <APIProvider
      apiKey={apiKey}
      // Fires on script-load failure only (network/CSP) — an auth rejection
      // after a successful load fires `window.gm_authFailure` instead, which
      // `DirectoryMap` handles alongside this callback.
      onError={(error) =>
        onLoadError(
          `the Maps script failed to load: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    >
      <GoogleMap
        mapId={DIRECTORY_MAP_ID}
        // `z-0` is the explicit stacking clamp for the safety invariant (see
        // the module comment): the positioned container gets z-index 0 and its
        // own stacking context, so nothing inside the Google map subtree —
        // whatever internal z-index Google's DOM uses — can ever stack above
        // the sibling z-10 carousel band. Do not remove it.
        className="absolute inset-0 z-0"
        // Initial camera: fit the current result pins (bounds computed from
        // real lat/lng), padded clear of the carousel band. Null bounds (no
        // usable coordinates) can't happen when the map view renders — the
        // route shows an empty state instead — but degrade to the whole-metro
        // projection box's spirit: let Maps pick its default.
        {...(bounds ? { defaultBounds: { ...bounds, padding: FIT_PADDING } } : {})}
        colorScheme={colorScheme}
        // One-finger pan/zoom inside the bounded canvas; POI icons stay
        // non-interactive so a Google info bubble never competes with our
        // safety pins/carousel. Default UI off — the view brings its own
        // controls (recenter FAB, carousel); pinch/scroll/keyboard still work.
        gestureHandling="greedy"
        disableDefaultUI
        clickableIcons={false}
        onDragstart={() => {
          userMoved.current = true;
        }}
        onZoomChanged={() => {
          if (!programmaticMove.current) {
            userMoved.current = true;
          }
        }}
        // The camera settles: any programmatic fit is complete, so subsequent
        // zoom events are user-initiated again.
        onIdle={() => {
          programmaticMove.current = false;
        }}
      >
        {entries.map(({ vm, lat, lng }, entryIndex) => (
          <AdvancedMarker
            key={vm.id}
            position={{ lat, lng }}
            // Match the placeholder's semantics: the pin body is centred on the
            // coordinate (the placeholder centres via -translate-x/y-1/2).
            anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
            zIndex={vm.id === selectedId ? 2 : 1}
          >
            {/* The same accessible pin as the fallback path: real <button>,
                colour + entries-order index number + "name, safety state"
                label, selected ring. Clicking selects (existing selectedId
                flow). The 1-based index matches the carousel card's chip
                because both map over the same `entries` array. */}
            <MapPinButton
              vm={vm}
              index={entryIndex + 1}
              selected={vm.id === selectedId}
              onSelect={onSelect}
            />
          </AdvancedMarker>
        ))}
        <RefitOnEntriesChange
          bounds={bounds}
          userMoved={userMoved}
          programmaticMove={programmaticMove}
        />
        <PanToSelection entries={entries} selectedId={selectedId} />
      </GoogleMap>
      <LiveRecenterFab bounds={bounds} userMoved={userMoved} programmaticMove={programmaticMove} />
    </APIProvider>
  );
}

/**
 * Re-fit the camera when the filtered result set (its bounds) changes — but
 * only while the visitor hasn't taken the camera over. Runs once on mount too,
 * which merely confirms the `defaultBounds` fit.
 */
function RefitOnEntriesChange({
  bounds,
  userMoved,
  programmaticMove,
}: {
  bounds: MapBounds | null;
  userMoved: { current: boolean };
  programmaticMove: { current: boolean };
}) {
  const map = useMap();
  useEffect(() => {
    if (!map || !bounds || userMoved.current) return;
    fitMapToBounds(map, bounds, programmaticMove);
  }, [map, bounds, userMoved, programmaticMove]);
  return null;
}

/**
 * Pan the camera to a user-selected entry (pin or mini-card tap) at the
 * current zoom — never a zoom change. Which selection changes count as a user
 * tap is the shared `useUserSelectionChange` discriminator (`map-ui.tsx`) —
 * the same one the carousel's scroll-into-view uses — so a mount/auto-select
 * or the route's post-filter validity reassign never pans, and the pan can't
 * fight `RefitOnEntriesChange`'s refit-unless-user-moved contract. The hook's
 * `ready` gate is the map instance itself: a selection made before the map
 * exists counts as initial (nothing to pan yet), not replayed later.
 *
 * The pan target is offset by half the carousel band so the pin lands centred
 * in the VISIBLE canvas above the band (`panBy` moves the camera down by
 * `+y` px, putting the pin that many px above centre). Under reduced motion
 * the camera jumps via the never-animated `moveCamera` to the raw centre —
 * the band offset needs a pixel→lat projection at the live zoom, and the pin
 * stays well clear of the band without it (canvas min-height ≫ 2× band).
 *
 * Leaves `userMoved` alone: the pan answers an explicit tap and fires no zoom
 * event, so the user-moved heuristic and the next filter-change refit behave
 * per `RefitOnEntriesChange`'s contract.
 */
function PanToSelection({
  entries,
  selectedId,
}: {
  entries: readonly DirectoryMapEntry[];
  selectedId: string | null;
}) {
  const map = useMap();
  useUserSelectionChange(map !== null, entries, selectedId, (id) => {
    const entry = entries.find((candidate) => candidate.vm.id === id);
    if (!map || !entry) return;
    const center = { lat: entry.lat, lng: entry.lng };
    if (prefersReducedMotion()) {
      map.moveCamera({ center });
    } else {
      map.panTo(center);
      map.panBy(0, CAROUSEL_BAND_PX / 2);
    }
  });
  return null;
}

/**
 * The functional recenter FAB (unwired in the fallback path): re-fits the
 * camera to the current pins and hands the camera back to the app (clears the
 * user-moved flag so filter changes auto-fit again).
 */
function LiveRecenterFab({
  bounds,
  userMoved,
  programmaticMove,
}: {
  bounds: MapBounds | null;
  userMoved: { current: boolean };
  programmaticMove: { current: boolean };
}) {
  const map = useMap();
  return (
    <RecenterFab
      onClick={() => {
        if (!map || !bounds) return;
        userMoved.current = false;
        fitMapToBounds(map, bounds, programmaticMove);
      }}
    />
  );
}
