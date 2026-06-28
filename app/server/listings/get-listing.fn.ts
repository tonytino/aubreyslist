import { createServerFn } from "@tanstack/react-start";
import { getListing, getListingInputSchema } from "./get-listing";

/**
 * Client-callable single-listing server function (issue #122).
 *
 * The ONLY part of the listing-detail read path that client code (the
 * `/listings/$id` route loader) imports. Following the `*.fn.ts` convention (see
 * `app/server/listings/browse.fn.ts`, `app/server/incidents/incidents.fn.ts`),
 * the db-touching implementation lives in `./get-listing.ts` and the TanStack
 * Start plugin strips this handler's body out of the browser bundle — so the
 * `/listings/$id` route loader running on the client during navigation no longer
 * pulls `getDb` (neon/drizzle) into its own client graph: the `findFirst` body
 * now lives behind this server fn (the #93 client-bundle-leak pattern).
 *
 * Validated input (the dynamic `$id` segment), so a malformed id is rejected
 * before it reaches the DB. Returns `null` for a non-existent id; the route
 * loader turns that into a `notFound()`.
 *
 * Server-only at runtime; safe to import from client modules.
 */
export const fetchListing = createServerFn({ method: "GET" })
  .validator(getListingInputSchema)
  .handler(({ data }) => getListing(data));
