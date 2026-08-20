import { createServerFn } from "@tanstack/react-start";
import { getListing, getListingInputSchema } from "./get-listing";

/**
 * Client-callable single-listing server function — the only part of the
 * listing-detail read path that client code imports. Per the `*.fn.ts`
 * convention, the db-touching implementation lives in `./get-listing.ts` and
 * the TanStack Start plugin strips this handler's body from the browser
 * bundle, so client imports never pull `getDb` (neon/drizzle) into their
 * graph.
 *
 * Validates the `$id` segment before it reaches the DB. Returns `null` for a
 * non-existent id; the route loader maps that to `notFound()`.
 *
 * Server-only at runtime; safe to import from client modules.
 */
export const fetchListing = createServerFn({ method: "GET" })
  .validator(getListingInputSchema)
  .handler(({ data }) => getListing(data));
