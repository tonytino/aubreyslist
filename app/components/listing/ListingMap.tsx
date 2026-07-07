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
 * exposure, nothing to load beyond the iframe itself. Per ADR-014
 * (docs/decisions/014-google-maps-platform-usage.md), this deliberately
 * revises v1's "no embedded map — deep-link only" decision (which older
 * comments mislabeled as ADR-009 — that ADR is Vercel hosting) now that the
 * Embed API's free tier removes the cost/quota risk behind the original rule.
 * The "Open in Google Maps" deep-link in `ListingLinks` stays — it is the
 * mobile hand-off to turn-by-turn in the native Maps app; this is a preview.
 *
 * Reuses the SAME public, referrer-restricted `VITE_GOOGLE_MAPS_BROWSER_KEY`
 * as the directory map (`~/lib/public-env`; ADR-014 §3 API-restricts it to
 * Maps JavaScript + Maps Embed). Absent/blank key → renders `null` — no empty
 * block, no layout shift, current (no-map) behaviour preserved, exactly like
 * `DirectoryMap`'s key-absent fallback — so local dev, CI, and E2E stay
 * deterministic without a key.
 *
 * Rendered as its own labelled `<section>` — a SIBLING of the "Links" region
 * on the detail page, never inside it: the edit-listing-links E2E spec
 * asserts link/button roles within that region and the map must not perturb
 * them.
 *
 * Query targeting:
 * - **Places listings** (`placeId` set) — `q=place_id:<placeId>`, the
 *   authoritative Places identifier, so the pin is exact regardless of name
 *   collisions.
 * - **Manual listings** (`placeId: null`, ADR-008) — `q=<name>, <address>`,
 *   the best available free-text query.
 *
 * `sandbox` is deliberately omitted: the Embed API needs script execution and
 * same-origin capabilities to boot Google's map UI, so a sandbox strict
 * enough to matter breaks it and `allow-scripts allow-same-origin` neuters
 * the sandbox anyway — the CSP `frame-src https://www.google.com` grant
 * (app/server/security/headers.ts) is the actual containment: no other
 * origin can ever be framed.
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
    <section
      aria-label="Map"
      className="aspect-video w-full overflow-hidden rounded-card border border-border"
    >
      <iframe
        src={src}
        title={`Map of ${name}`}
        className="h-full w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
    </section>
  );
}
