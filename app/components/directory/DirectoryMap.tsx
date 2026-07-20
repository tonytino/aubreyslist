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
 * The directory Map view (AUB-61 Phase 2b → AUB-111).
 *
 * Two render paths behind ONE public component:
 *
 * - **Real map** (`DirectoryMapLive.tsx`) — when the PUBLIC, referrer-restricted
 *   `VITE_GOOGLE_MAPS_BROWSER_KEY` is provisioned (AUB-217), a Google map via
 *   `@vis.gl/react-google-maps` with `<AdvancedMarker>` pins at true lat/lng.
 * - **CSS-placeholder fallback** (this file) — when the key is absent/blank
 *   (local dev, CI, E2E, un-provisioned deploys), EXACTLY the pre-AUB-111
 *   stylized view: a CSS backdrop (grid + park/water blobs) with pins projected
 *   from each listing's REAL `lat`/`lng` via a fixed metro-Denver bounding box
 *   (`projectToMap`), and the recenter FAB present but unwired.
 *
 * Both paths share the SAME pin visuals, accessible names, and the bottom
 * mini-card carousel (`map-ui.tsx`), so the safety-signal contract and the
 * carousel-above-pins invariant below hold identically in both.
 *
 * SAFETY-CORRECTNESS (from the bundle, NON-NEGOTIABLE): a pin carries a safety
 * signal (colour + icon + label), so a pin must NEVER visually float over a
 * DIFFERENT restaurant's card — a mis-associated safety signal is a real harm
 * (e.g. a red incident pin bleeding onto a celiac-safe card). We enforce this two
 * ways: the carousel sits at `z-10` ABOVE the pins (`z-1`/`z-6` here; the whole
 * map canvas in the live path) AND draws an OPAQUE background band, so any low
 * pin hides BEHIND the band instead of over a card.
 *
 * ACCESSIBILITY: every pin and mini-card is a real `<button>`; the pin's icon is
 * decorative and its accessible name is the restaurant name + its safety state,
 * so the safety meaning is never colour-only. The selected pin/mini-card carry
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
  // PUBLIC, compile-time key (see app/lib/public-env.ts). Absent → the
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

      {/* Bottom carousel — MUST sit above the pins with an OPAQUE band so a low
          pin can never bleed over a mini-card (safety-correctness; see
          map-ui.tsx). Shared verbatim by both map paths. */}
      <MapCarousel entries={entries} selectedId={selectedId} onSelect={onSelect} />
    </div>
  );
}

/**
 * The key-absent fallback: the pre-AUB-111 stylized placeholder, unchanged —
 * decorative backdrop + `projectToMap`-projected pins + an unwired recenter
 * FAB. Kept deliberately so the map PR is mergeable before the key exists and
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
        {entries.map(({ vm, lat, lng }) => {
          const { left, top } = projectToMap(lat, lng);
          const selected = vm.id === selectedId;
          return (
            <li key={vm.id}>
              <MapPinButton
                vm={vm}
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
