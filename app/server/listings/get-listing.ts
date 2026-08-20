import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import { type Listing, listings } from "~/db/schema";

/**
 * Validated input for {@link getListing}: the dynamic `$id` route segment.
 * Rejects an empty id before it reaches the DB.
 */
export const getListingInputSchema = z.object({ id: z.string().min(1) });

/** Validated shape accepted by {@link getListing}. */
export type GetListingInput = z.infer<typeof getListingInputSchema>;

/**
 * Single-listing-by-id loader for the detail page. Returns `null` when
 * nothing matches; the route loader maps that to `notFound()`.
 *
 * Public read: a hidden/removed listing (`moderationStatus != 'visible'`) is
 * treated exactly like a non-existent one, so a moderated-away listing is
 * unreachable by direct link. Content is soft-moderated — a moderator can
 * restore it, but the public never sees it. Moderation does not propagate
 * parent→child: the claim and incident loaders join `listings` and require it
 * `visible` themselves, so hiding a listing also drops its claims/incidents
 * from their own reads.
 *
 * Server-only: imports the DB client. The client-callable wrapper lives in
 * `./get-listing.fn.ts`.
 */
export async function getListing({ id }: GetListingInput): Promise<Listing | null> {
  const listing = await getDb().query.listings.findFirst({
    where: and(eq(listings.id, id), eq(listings.moderationStatus, "visible")),
  });
  return listing ?? null;
}
