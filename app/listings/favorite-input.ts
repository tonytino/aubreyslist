/**
 * Client-safe favorite input contract (issue AUB-120 / F2).
 *
 * CLIENT-SAFE: the Zod validator + inferred input type for the favorite /
 * unfavorite writes. It imports only `z` — NO `~/db` / drizzle / neon value
 * import — mirroring `app/listings/create-input.ts` (#141), so the
 * `favoriteListing` / `unfavoriteListing` server-fn wrappers (`favorites.fn.ts`)
 * can back their `.validator()` with this schema without dragging the
 * db-touching `~/server/favorites/index` graph into the client bundle.
 */

import { z } from "zod";

/** A favorite / unfavorite of a single listing, addressed by its id. */
export const favoriteInputSchema = z.object({ listingId: z.string().min(1) });
export type FavoriteInput = z.infer<typeof favoriteInputSchema>;
