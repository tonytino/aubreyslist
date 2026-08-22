import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { cn } from "~/lib/utils";
import type { ListingPreview } from "~/listings/photo-preview-state";
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
 * "Photo: {author}" line over the scrim whenever one is shown — including during the
 * preview-only phase below, from the card's own attribution names.
 *
 * BLUR-UP `preview`: when a viewer arrives from a browse card already showing this
 * listing's photo, `preview` carries that browser-cached 640px URL and its
 * attribution names (consumed once from router state — `~/listings/photo-preview-state`).
 * It renders as a blurred underlay (credit included) the instant it is available, and
 * the sharp 1280px photo fades in over it on load. A direct visit/refresh carries no
 * `preview`, so every branch below collapses to the pre-existing behavior byte-for-byte.
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

/**
 * Client freshness window for the hero photos query, matching the server-side
 * per-Place-ID cache TTL (`PLACE_PHOTOS_CACHE_TTL_MS`, `~/server/places-photos`)
 * so a tab left open past that window revalidates instead of holding a
 * possibly-rotated photo token indefinitely.
 */
export const LISTING_PHOTOS_STALE_TIME_MS = 12 * 60 * 60 * 1000;
/**
 * At least `LISTING_PHOTOS_STALE_TIME_MS`, so a remount before that window
 * elapses still hits cache (defined independently — not an alias — so the
 * dead-code gate doesn't flag a duplicate export; the >= relationship is
 * pinned by a test).
 */
export const LISTING_PHOTOS_GC_TIME_MS = 12 * 60 * 60 * 1000;

/**
 * Shared attribution-line chrome (styling.md): above the scrim (z-20, like the
 * name/address block) so the credit stays AA-legible on the darkest part of the
 * photo. Bottom-right, single line, truncated — it may never crowd the name/
 * address at 375px. Google's Places attribution requirement ("must display and be
 * legible") and the AA-contrast rule both hold: the line sits at the near-opaque
 * stop of the hero scrim, and even over a pure-white photo the /75 scrim +
 * white/80 text clears ~7.3:1 — don't lighten either without re-checking that
 * worst case.
 */
const PHOTO_CREDIT_CLASS =
  "absolute bottom-1.5 right-3 z-20 max-w-[70%] truncate text-[11px] text-white/80 [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]";

export function HeroPhoto({
  listingId,
  preview,
}: {
  listingId: string;
  preview?: ListingPreview | undefined;
}) {
  // A broken image (e.g. the proxy 503s after the kill switch flips mid-session)
  // falls back to the gradient. Storing the failed src (not a boolean) scopes the
  // suppression to the exact image that broke: when navigation reuses this instance
  // for another listing, the new src does not match and the photo renders again.
  // The call site additionally keys the component by listing id.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [fullResLoaded, setFullResLoaded] = useState(false);

  const { data: photos, isPending } = useQuery({
    queryKey: listingPhotosQueryKey(listingId),
    queryFn: () => fetchListingPhotos({ data: { listingId } }),
    staleTime: LISTING_PHOTOS_STALE_TIME_MS,
    gcTime: LISTING_PHOTOS_GC_TIME_MS,
    retry: 1,
  });

  // Hero shows the first photo only; errors surface as `data: undefined`.
  const photo = photos?.[0];
  const src = photo ? placePhotoProxyUrl(photo.photoToken, HERO_PHOTO_MAX_WIDTH_PX) : null;
  const fullResFailed = src !== null && failedSrc === src;
  // The query has settled with no usable photo (empty result, or the query
  // errored and exhausted its retry) — distinct from still loading, where the
  // preview should keep standing in.
  const settledWithNoPhoto = !isPending && !photo;
  const showPreview = preview !== undefined && !fullResFailed && !settledWithNoPhoto;

  // A failed full-res load falls back to the pre-existing "nothing" state, never
  // the stale preview. Absent a preview, this is exactly the original `!photo`
  // early return.
  if (fullResFailed || (!showPreview && !photo)) return null;

  return (
    <>
      {showPreview && preview ? (
        // Underlay: blurred/slightly scaled up (hides the blur's soft edges) so
        // the sharp photo can fade in over it without a visible seam. Stays
        // mounted through the fade — once the full-res `<img>` reaches opacity
        // 100 it fully covers this layer.
        <img
          src={preview.src}
          alt=""
          className="absolute inset-0 z-0 h-full w-full scale-105 object-cover blur-[2px]"
        />
      ) : null}
      {photo && src ? (
        // Decorative (alt="") — the listing name/address live in the overlaid
        // text. Lazy so the document render never waits on Google. z-0 keeps it
        // above the gradient/blob/placeholder layers (earlier siblings) and
        // below the scrim + z-20/z-30 text/action layers.
        <img
          src={src}
          alt=""
          loading="lazy"
          onLoad={() => setFullResLoaded(true)}
          onError={() => setFailedSrc(src)}
          className={
            preview !== undefined
              ? cn(
                  "absolute inset-0 z-0 h-full w-full object-cover transition-opacity duration-500 motion-reduce:transition-none",
                  fullResLoaded ? "opacity-100" : "opacity-0"
                )
              : "absolute inset-0 z-0 h-full w-full object-cover"
          }
        />
      ) : null}
      {photo && photo.attributions.length > 0 ? (
        <p className={PHOTO_CREDIT_CLASS}>
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
      ) : !photo && showPreview && preview && preview.attributionNames.length > 0 ? (
        // Preview-only phase: the query hasn't resolved the real photo (with its
        // own attribution data) yet, so credit the card's photo from the names it
        // carried over — plain text (no profile links; the card doesn't have
        // them either). The real block above takes over the instant `photo`
        // resolves, dropping this one.
        <p className={PHOTO_CREDIT_CLASS}>Photo: {preview.attributionNames.join(", ")}</p>
      ) : null}
    </>
  );
}
