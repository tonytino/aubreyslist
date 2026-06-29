/**
 * Client-safe add-listing input contract (issues #26, #90, #141).
 *
 * CLIENT-SAFE: the Zod validator + inferred input type for the add-listing write,
 * plus the `CreateListingResult` shape. It imports only `z`, the pure
 * `isHttpUrl` scheme guard, and a TYPE-only `Listing` (erased at build) — NO
 * `~/db` / drizzle / neon value import, mirroring `app/listings/taxonomy.ts`
 * (#126).
 *
 * Living here (not in the db-touching `~/server/listings/create`) lets the
 * `createListing` server-fn wrapper (`create.fn.ts`) back its `.validator()` with
 * this schema without statically pulling `create.ts`'s drizzle/neon graph into
 * the `listings.new` client chunk. `create.ts` re-exports these so server code and
 * the existing create tests keep one import surface.
 */

import { z } from "zod";
import type { Listing } from "~/db/schema";
import { isHttpUrl } from "~/server/listings/url";

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
 * `menuUrl` is optional in both modes; an empty string is normalised to
 * `undefined` so a blank field stores `null` rather than `""`.
 *
 * The scheme is restricted to http(s) ({@link isHttpUrl}): `z.string().url()`
 * alone accepts `javascript:`/`data:` URLs, which — rendered into the detail
 * page's anchor `href` — is a stored-XSS / untrusted-navigation vector (#90).
 */
const optionalMenuUrl = z
  .union([
    z
      .string()
      .url("Enter a valid URL (including https://).")
      .max(2048)
      .refine(isHttpUrl, "Menu URL must start with http:// or https://."),
    z.literal(""),
  ])
  .optional()
  .transform((value) => (value ? value : undefined));

export const createListingInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("places"),
    placeId: z.string().min(1, "placeId is required"),
    menuUrl: optionalMenuUrl,
  }),
  z.object({
    mode: z.literal("manual"),
    name: z.string().min(1, "Name is required").max(256),
    address: z.string().min(1, "Address is required").max(512),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    menuUrl: optionalMenuUrl,
  }),
]);
export type CreateListingInput = z.infer<typeof createListingInputSchema>;
