import { createServerFn } from "@tanstack/react-start";
import { favoriteInputSchema } from "~/listings/favorite-input";
import { addFavorite, getViewerFavoriteIds, removeFavorite } from "./index";

/**
 * Client-callable favorite server functions (issue AUB-120 / F2).
 *
 * These `createServerFn` entry points are the ONLY part of the favorites server
 * layer that client code imports. Following the `*.fn.ts` convention (see
 * `attestations.fn.ts`, `current-user.fn.ts`), the db-touching implementations
 * live in `./index.ts` and the TanStack Start plugin strips these handler bodies
 * out of the browser bundle — so importing from here never drags `getDb`
 * (neon/drizzle) into the client build.
 *
 * The write validators reuse the client-safe {@link favoriteInputSchema} from
 * `~/listings/favorite-input` (which imports only `zod`), so no schema/drizzle
 * runtime leaks to the client.
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
