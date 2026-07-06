import { createServerFn } from "@tanstack/react-start";
import { listingPhotosInputSchema, type PlacePhoto, runListingPhotos } from "./places-photos";

/**
 * Client-callable listing-photos server function (AUB-215).
 *
 * The ONLY part of the place-photos layer that client code (the listing-detail
 * hero) imports. Following the `*.fn.ts` convention (see
 * `app/server/listings/browse.fn.ts`), the server-only implementation lives in
 * `./places-photos` and the TanStack Start plugin strips this handler's body
 * out of the browser bundle — so importing from here never drags `getDb`
 * (neon/drizzle) or the server-side `GOOGLE_PLACES_API_KEY` handling into the
 * client build.
 *
 * Open/anonymous READ, like the listing page itself: it takes a listing id
 * (never a raw Place ID from the client), resolves the Place ID server-side
 * via the visibility-aware `getListing`, and the result is cached per Place ID
 * for {@link PLACE_PHOTOS_CACHE_TTL_MS} — so a burst of page views costs at
 * most one billed photos-only call per place per TTL window. Nothing
 * Google-sourced is persisted (ADR-013); the returned `photoToken`s are
 * transient handles for the `/api/places/photo` media proxy.
 *
 * Server-only at runtime; safe to import from client modules.
 */
export const fetchListingPhotos = createServerFn({ method: "GET" })
  .validator(listingPhotosInputSchema)
  .handler(async ({ data }): Promise<PlacePhoto[]> => runListingPhotos(data));
