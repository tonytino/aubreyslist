import { DirectoryMapLive } from "~/components/directory/DirectoryMapLive";
import { projectToMap } from "~/components/directory/map-projection";
import {
  type DirectoryMapEntry,
  MapCarousel,
  MapPinButton,
  RecenterFab,
} from "~/components/directory/map-ui";
import { googleMapsBrowserKey } from "~/lib/public-env";

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

export function DirectoryMap({
  entries,
  selectedId,
  onSelect,
}: {
  entries: readonly DirectoryMapEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Public, compile-time key (see app/lib/public-env.ts). Absent → the
  // deterministic CSS-placeholder fallback, so the view (and CI/E2E) never
  // depends on key provisioning or Google availability.
  const apiKey = googleMapsBrowserKey();

  return (
    <div className="absolute inset-0 overflow-hidden">
      {apiKey ? (
        <DirectoryMapLive
          apiKey={apiKey}
          entries={entries}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ) : (
        <PlaceholderMap entries={entries} selectedId={selectedId} onSelect={onSelect} />
      )}

      {/* Bottom carousel — must sit above the pins with an opaque band so a low
          pin can never bleed over a mini-card (safety-correctness; see
          map-ui.tsx). Shared verbatim by both map paths. */}
      <MapCarousel entries={entries} selectedId={selectedId} onSelect={onSelect} />
    </div>
  );
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
