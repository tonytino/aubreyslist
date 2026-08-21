import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getSetting } from "~/server/settings";
import { type BrowseListingsPage, browseListingsInputSchema, getBrowseListings } from "./browse";
import { coarseCoordsFromHeaders } from "./request-geo";

/**
 * Client-callable browse-list server function — the only part of the browse
 * server layer that client code imports. Per the `*.fn.ts` convention, the
 * db-touching implementation lives in `./browse.ts` and the TanStack Start
 * plugin strips this handler's body from the browser bundle, so client
 * imports never drag `getDb` (neon/drizzle) into the client build.
 *
 * The handler resolves "now" once on the server and reads the admin-tunable
 * `staleness_months` setting (ADR-007), then threads both into the pure trust
 * derivation so the headline glance matches the listing-detail page exactly
 * (no SSR/client drift, no hard-coded window).
 *
 * It also resolves the request's coarse location, which anchors the default
 * "near me" sort before (or without) a browser reading. Taken from the request
 * headers, never from `data`: an anchor the client could assert would let any
 * caller claim to be anywhere.
 *
 * Server-only at runtime; safe to import from client modules.
 *
 * Caching/privacy (spec §11.1 — never publicly cache viewer-specific data): a
 * `savedOnly` browse response depends on the signed-in user's favorites, so
 * it must never be shared/edge/CDN-cached. Browse sets no explicit
 * `Cache-Control`: the response renders SSR-per-request into a per-request
 * React Query cache, and an auth change triggers a full-page reload, so a
 * `savedOnly` result cannot leak across sessions. The route's query key
 * includes the `saved` flag, so saved and unsaved views cache independently.
 * If an explicit browse `Cache-Control` is ever introduced, the
 * `data.savedOnly` path must be `private, no-store` per §11.1.
 */
export const fetchBrowseListings = createServerFn({ method: "GET" })
  .validator(browseListingsInputSchema)
  .handler(async ({ data }): Promise<BrowseListingsPage> => {
    const stalenessMonths = await getSetting("staleness_months");
    const coarseOrigin = coarseCoordsFromHeaders(getRequest().headers);
    return getBrowseListings(data, new Date(), stalenessMonths, coarseOrigin);
  });
