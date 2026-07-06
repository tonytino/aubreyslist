import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { placePhotoProxyUrl } from "~/listings/place-photo-url";
import { fetchListingPhotos } from "~/server/places-photos.fn";

/**
 * Render-time Google Place photo for the listing-detail hero (AUB-215).
 *
 * Sits INSIDE the hero media band, between the brand-gradient/blob layers and
 * the bottom scrim: when a photo resolves, the `<img>` covers the gradient
 * (and the "Food photo" placeholder label); until then — and on every failure
 * mode (no Place ID, kill switch off, key unset, upstream error, broken image)
 * — it renders nothing and the existing gradient band shows through unchanged.
 *
 * Fetching is a client-side TanStack Query (never in the route loader, no
 * suspense): photos are decorative and must never block or break page render.
 * The photo itself loads through the `/api/places/photo` server-side media
 * proxy — nothing Google-sourced is persisted and no key ships to the client
 * (ADR-013).
 *
 * Attribution: Google photos require author credit, so a real photo renders a
 * small "Photo: {author}" line over the scrim (linking to the author profile
 * when available). It only exists when a photo is actually shown.
 */

/**
 * Width requested from the proxy for the hero band. The band renders edge to
 * edge in a `max-w-3xl` card (~768px CSS), so 1280px covers retina displays
 * without asking Google for the full-size original (proxy clamps to 1600 max).
 */
export const HERO_PHOTO_MAX_WIDTH_PX = 1280;

/** Query key for a listing's render-time place photos. */
export function listingPhotosQueryKey(listingId: string) {
  return ["listing-photos", listingId] as const;
}

export function HeroPhoto({ listingId }: { listingId: string }) {
  // Ephemeral render state, not data fetching: a broken image (e.g. the proxy
  // 503s after the kill switch flips mid-session) falls back to the gradient.
  const [imageFailed, setImageFailed] = useState(false);

  const { data: photos } = useQuery({
    queryKey: listingPhotosQueryKey(listingId),
    queryFn: () => fetchListingPhotos({ data: { listingId } }),
    // Server-side metadata is cached ~12h per place; within a session there is
    // nothing to refetch for a decorative image.
    staleTime: Infinity,
    retry: 1,
  });

  // Hero shows the FIRST photo only; errors surface as `data: undefined`.
  const photo = photos?.[0];
  if (!photo || imageFailed) return null;

  return (
    <>
      {/* Decorative (alt="") — the listing name/address live in the overlaid
          text. Lazy so the document render never waits on Google. z-0 keeps it
          above the gradient/blob/placeholder layers (earlier siblings) and
          below the scrim + z-20/z-30 text/action layers. */}
      <img
        src={placePhotoProxyUrl(photo.photoToken, HERO_PHOTO_MAX_WIDTH_PX)}
        alt=""
        loading="lazy"
        onError={() => setImageFailed(true)}
        className="absolute inset-0 z-0 h-full w-full object-cover"
      />
      {photo.attributions.length > 0 ? (
        // Above the scrim (z-20, like the name/address block) so the credit
        // stays AA-legible on the darkest part of the photo. Bottom-right,
        // single line, truncated — it may never crowd the name/address at 375px.
        <p className="absolute bottom-1.5 right-3 z-20 max-w-[70%] truncate text-caption text-white/90 [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]">
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
