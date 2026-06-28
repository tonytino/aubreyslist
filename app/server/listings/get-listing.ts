import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import { type Listing, listings } from "~/db/schema";

/**
 * Validated input for {@link getListing}: the dynamic `$id` route segment. A
 * malformed (empty) id is rejected before it ever reaches the DB.
 */
export const getListingInputSchema = z.object({ id: z.string().min(1) });

/** Validated shape accepted by {@link getListing}. */
export type GetListingInput = z.infer<typeof getListingInputSchema>;

/**
 * Single-listing-by-id loader for the detail page. Returns `null` for a
 * non-existent id; the route loader turns that into a `notFound()` so the
 * not-found UI renders (rather than crashing or 500-ing).
 *
 * Server-only: imports the DB client. The client-callable `createServerFn`
 * wrapper lives in `./get-listing.fn.ts`, whose handler body the TanStack Start
 * plugin strips from the browser bundle — so this never drags `getDb`
 * (neon/drizzle) into a client route's graph (#93, #122).
 */
export async function getListing({ id }: GetListingInput): Promise<Listing | null> {
  const listing = await getDb().query.listings.findFirst({
    where: eq(listings.id, id),
  });
  return listing ?? null;
}
