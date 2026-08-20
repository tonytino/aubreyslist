import { createServerFn } from "@tanstack/react-start";
import {
  getPhotosForListings,
  type ListingPhotoMap,
  listingIdsInputSchema,
  listingPhotosInputSchema,
  type PlacePhoto,
  runListingPhotos,
} from "./places-photos";

/**
 * Client-callable listing-photos server function.
 *
 * The only part of the place-photos layer that client code (the
 * listing-detail hero) imports. Per the `*.fn.ts` convention, the server-only
 * implementation lives in `./places-photos`; the TanStack Start plugin strips
 * this handler's body from the browser bundle, so importing from here never
 * drags `getDb` (neon/drizzle) or the server-side `GOOGLE_PLACES_API_KEY`
 * handling into the client build.
 *
 * Open/anonymous read, like the listing page itself: it takes a listing id
 * (never a raw Place ID from the client), resolves the Place ID server-side
 * via the visibility-aware `getListing`, and the result is cached per Place
 * ID for {@link PLACE_PHOTOS_CACHE_TTL_MS} — a burst of page views costs at
 * most one billed photos-only call per place per TTL window. Nothing
 * Google-sourced is persisted (ADR-014); the returned `photoToken`s are
 * transient handles for the `/api/places/photo` media proxy.
 *
 * Server-only at runtime; safe to import from client modules.
 */
export const fetchListingPhotos = createServerFn({ method: "GET" })
  .validator(listingPhotosInputSchema)
  .handler(async ({ data }): Promise<PlacePhoto[]> => runListingPhotos(data));

/**
 * Client-callable batch listing-photos server function.
 *
 * The browse route's List/Map surfaces import this — never `./places-photos`
 * directly — so their client bundle stays free of
 * `getDb`/`GOOGLE_PLACES_API_KEY` handling, exactly like
 * {@link fetchListingPhotos} above.
 *
 * Open/anonymous read, like the browse page itself: it takes the current
 * page's listing ids (never a raw Place ID from the client), batches the
 * Place ID lookup and the upstream photo fetch server-side, and answers a
 * listing-id -> photo map through the same per-Place-ID cache
 * {@link fetchListingPhotos} warms — a place's photo is fetched at most once
 * per {@link PLACE_PHOTOS_CACHE_TTL_MS} window no matter which surface (hero,
 * list card, map carousel) asks first.
 *
 * Server-only at runtime; safe to import from client modules.
 */
export const fetchBrowsePhotos = createServerFn({ method: "GET" })
  .validator(listingIdsInputSchema)
  .handler(async ({ data }): Promise<ListingPhotoMap> => getPhotosForListings(data));
