import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { placePhotoProxyUrl } from "~/listings/place-photo-url";
import { fetchListingPhotos } from "~/server/places-photos.fn";

/**
 * Render-time Google Place photo for the listing-detail hero.
 *
 * Sits inside the hero media band, between the brand-gradient/blob layers and the
 * bottom scrim: when a photo resolves, the `<img>` covers the gradient; until then —
 * and on every failure mode (no Place ID, kill switch off, key unset, upstream error,
 * broken image) — it renders nothing and the gradient band shows through unchanged.
 *
 * Fetching is a client-side TanStack Query (never in the route loader, no suspense):
 * photos are decorative and must never block or break page render. The photo loads
 * through the `/api/places/photo` server-side proxy — nothing Google-sourced is
 * persisted and no key ships to the client (ADR-014).
 *
 * Attribution: Google photos require author credit, so a real photo renders a small
 * "Photo: {author}" line over the scrim, only when a photo is actually shown.
 */

/**
 * Width requested from the proxy for the hero band. The band renders edge to edge in
 * a `max-w-3xl` card (~768px CSS), so 1280px covers retina displays without asking
 * Google for the full-size original. A rung on the proxy's fixed width ladder —
 * off-ladder asks get quantized server-side.
 */
export const HERO_PHOTO_MAX_WIDTH_PX = 1280;

/** Query key for a listing's render-time place photos. */
export function listingPhotosQueryKey(listingId: string) {
  return ["listing-photos", listingId] as const;
}

export function HeroPhoto({ listingId }: { listingId: string }) {
  // A broken image (e.g. the proxy 503s after the kill switch flips mid-session)
  // falls back to the gradient. Storing the failed src (not a boolean) scopes the
  // suppression to the exact image that broke: when navigation reuses this instance
  // for another listing, the new src does not match and the photo renders again.
  // The call site additionally keys the component by listing id.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const { data: photos } = useQuery({
    queryKey: listingPhotosQueryKey(listingId),
    queryFn: () => fetchListingPhotos({ data: { listingId } }),
    // Server-side metadata is cached ~12h per place; within a session there is
    // nothing to refetch for a decorative image.
    staleTime: Infinity,
    retry: 1,
  });

  // Hero shows the first photo only; errors surface as `data: undefined`.
  const photo = photos?.[0];
  if (!photo) return null;

  const src = placePhotoProxyUrl(photo.photoToken, HERO_PHOTO_MAX_WIDTH_PX);
  if (failedSrc === src) return null;

  return (
    <>
      {/* Decorative (alt="") — the listing name/address live in the overlaid
          text. Lazy so the document render never waits on Google. z-0 keeps it
          above the gradient/blob/placeholder layers (earlier siblings) and
          below the scrim + z-20/z-30 text/action layers. */}
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailedSrc(src)}
        className="absolute inset-0 z-0 h-full w-full object-cover"
      />
      {photo.attributions.length > 0 ? (
        // Above the scrim (z-20, like the name/address block) so the credit stays
        // AA-legible on the darkest part of the photo. Bottom-right, single line,
        // truncated — it may never crowd the name/address at 375px. Google's Places
        // attribution requirement ("must display and be legible") and the AA-contrast
        // rule (styling.md) both hold: the line sits at the near-opaque stop of the
        // hero scrim, and even over a pure-white photo the /75 scrim + white/80 text
        // clears ~7.3:1 — don't lighten either without re-checking that worst case.
        <p className="absolute bottom-1.5 right-3 z-20 max-w-[70%] truncate text-[11px] text-white/80 [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]">
          Photo:{" "}
          {photo.attributions.map((attribution, index) => (
            // Content-derived key: an author is identified by profile link +
            // display name (Google never repeats an author on one photo).
            <Fragment key={`${attribution.uri ?? ""}|${attribution.displayName}`}>
              {index > 0 ? ", " : null}
              {attribution.uri ? (
                <a
                  href={attribution.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-white/60 underline-offset-2 hover:text-white"
                >
                  {attribution.displayName}
                </a>
              ) : (
                attribution.displayName
              )}
            </Fragment>
          ))}
        </p>
      ) : null}
    </>
  );
}
