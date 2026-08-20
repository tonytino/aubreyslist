/**
 * Client-safe add-listing input contract: the Zod validator + inferred input
 * type for the add-listing write, plus the `CreateListingResult` shape. It
 * imports only `z`, the client-safe typed-links schema, and a type-only
 * `Listing` (erased at build) — no `~/db` / drizzle / neon value import.
 *
 * Living here (not in the db-touching `~/server/listings/create`) lets the
 * `createListing` server-fn wrapper back its `.validator()` with this schema
 * without pulling the drizzle/neon graph into the `listings.new` client
 * chunk. `create.ts` re-exports these so server code keeps one import
 * surface.
 */

import { z } from "zod";
import type { Listing } from "~/db/schema";
import { listingLinksInputSchema } from "~/listings/links";

/** Result of an add-listing write: the listing plus whether it was newly created. */
export interface CreateListingResult {
  listing: Listing;
  /** `false` when a places-mode submission resolved to an already-existing listing. */
  created: boolean;
}

/**
 * Validated input for the add-listing write. A discriminated union on `mode`:
 *
 * - `places`: the client sends only the chosen `placeId`; canonical fields are
 *   resolved server-side, so the client cannot spoof name/address/coords.
 * - `manual`: the client sends the canonical fields directly.
 *
 * `links` is the optional set of typed links, one per kind at most. Blank
 * fields are dropped client-side before submit, so every entry arriving here
 * carries a validated http(s)-only URL ({@link listingLinksInputSchema} —
 * `z.string().url()` alone accepts `javascript:`/`data:` URLs, a stored-XSS
 * vector at the detail page's anchor `href` sink). New writes go to
 * `listing_links`, never the legacy `listings.menu_url` column.
 */
const optionalLinks = listingLinksInputSchema.optional();

export const createListingInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("places"),
    placeId: z.string().min(1, "placeId is required"),
    links: optionalLinks,
  }),
  z.object({
    mode: z.literal("manual"),
    name: z.string().trim().min(1, "Name is required").max(256),
    address: z.string().trim().min(1, "Address is required").max(512),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    links: optionalLinks,
  }),
]);
export type CreateListingInput = z.infer<typeof createListingInputSchema>;
