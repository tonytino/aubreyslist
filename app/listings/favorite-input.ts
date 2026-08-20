/**
 * Client-safe input contract for the favorite / unfavorite writes. Imports
 * only `z` — no `~/db` / drizzle / neon value import — so the server-fn
 * wrappers can back their `.validator()` with this schema without dragging
 * the db-touching favorites graph into the client bundle.
 */

import { z } from "zod";

/** A favorite / unfavorite of a single listing, addressed by its id. */
export const favoriteInputSchema = z.object({ listingId: z.string().min(1) });
export type FavoriteInput = z.infer<typeof favoriteInputSchema>;
