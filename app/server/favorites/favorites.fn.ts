import { createServerFn } from "@tanstack/react-start";
import { favoriteInputSchema } from "~/listings/favorite-input";
import type { BrowseListingCard } from "~/server/listings/browse";
import { getSetting } from "~/server/settings";
import { addFavorite, getViewerFavoriteIds, getViewerFavorites, removeFavorite } from "./index";

/**
 * Client-callable favorite server functions — the only part of the favorites
 * server layer that client code imports. The db-touching implementations live
 * in `./index.ts`; the TanStack Start plugin strips these handler bodies from
 * the browser bundle, so importing from here never drags `getDb` (neon/drizzle)
 * into the client build.
 *
 * The write validators reuse the client-safe {@link favoriteInputSchema}
 * (imports only `zod`), so no schema/drizzle runtime leaks to the client.
 */

/** Favorite a listing (login-gated, validated). See {@link addFavorite}. */
export const favoriteListing = createServerFn({ method: "POST" })
  .validator(favoriteInputSchema)
  .handler(({ data }) => addFavorite(data));

/** Unfavorite a listing (login-gated, validated). See {@link removeFavorite}. */
export const unfavoriteListing = createServerFn({ method: "POST" })
  .validator(favoriteInputSchema)
  .handler(({ data }) => removeFavorite(data));

/** The current viewer's favorited listing ids. See {@link getViewerFavoriteIds}. */
export const fetchViewerFavoriteIds = createServerFn({ method: "GET" }).handler(() =>
  getViewerFavoriteIds()
);

/**
 * The current viewer's favorited listings as browse cards — the data behind
 * the `/favorites` page. See {@link getViewerFavorites}.
 *
 * Resolves "now" once on the server and reads `staleness_months` the same way
 * `fetchBrowseListings` does, then threads both into the shared card builder
 * so `/favorites` cards match browse exactly. Anonymous callers resolve to
 * `[]` with no DB hit.
 */
export const fetchViewerFavorites = createServerFn({ method: "GET" }).handler(
  async (): Promise<BrowseListingCard[]> => {
    const stalenessMonths = await getSetting("staleness_months");
    return getViewerFavorites(new Date(), stalenessMonths);
  }
);
