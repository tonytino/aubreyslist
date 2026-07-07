import { googleMapsBrowserKey } from "~/lib/public-env";

interface ListingMapProps {
  /** Restaurant name — the accessible iframe title and part of the manual-listing query. */
  name: string;
  /** Street address — combined with `name` as the query for manual (non-Places) listings. */
  address: string;
  /** Places `place_id`, or `null` for a manually-added listing (ADR-008). */
  placeId: string | null;
}

/**
 * Embedded per-restaurant map on the listing detail page (AUB-216, ADR-014).
 *
 * Uses the Google Maps **Embed API** — a plain `<iframe>`, free and
 * unrestricted-quota, unlike the Maps JavaScript API the directory map uses
 * (AUB-111, `DirectoryMapLive.tsx`). No JS SDK, no client-side billing
 * exposure, nothing to load beyond the iframe itself. ADR-014 revises
 * ADR-009's original "no embedded map" call now that the Embed API's free
 * tier removes the cost/quota risk that motivated it.
 *
 * Reuses the SAME public, referrer-restricted `VITE_GOOGLE_MAPS_BROWSER_KEY`
 * as the directory map (`~/lib/public-env`). Absent/blank key → renders
 * `null` — no layout shift, current (no-map) behaviour preserved, exactly
 * like `DirectoryMap`'s key-absent fallback path — so local dev, CI, and E2E
 * stay deterministic without a key.
 *
 * Query targeting:
 * - **Places listings** (`placeId` set) — `q=place_id:<placeId>`, the
 *   authoritative Places identifier, so the pin is exact regardless of name
 *   collisions.
 * - **Manual listings** (`placeId: null`, ADR-008) — `q=<name>, <address>`,
 *   the best available free-text query.
 *
 * Dark mode: the Embed API has no dark-styling option, so the iframe always
 * renders Google's light map tiles even when the app is in dark mode. A
 * documented limitation of the free embed, not a bug.
 */
export function ListingMap({ name, address, placeId }: ListingMapProps) {
  const apiKey = googleMapsBrowserKey();
  if (!apiKey) {
    return null;
  }

  const q = placeId
    ? `place_id:${encodeURIComponent(placeId)}`
    : encodeURIComponent(`${name}, ${address}`);
  const src = `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(apiKey)}&q=${q}`;

  return (
    <div className="aspect-video w-full overflow-hidden rounded-card border border-border">
      <iframe
        src={src}
        title={`Map of ${name}`}
        className="h-full w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
    </div>
  );
}
