import { queryOptions } from "@tanstack/react-query";
import { BROWSE_PAGE_SIZE, type UserCoords } from "~/listings/browse-params";
import type { QuickFilterValue } from "~/listings/quick";
import type { BrowseSort } from "~/listings/sort";
import type { ClaimAttribute } from "~/listings/taxonomy";
import { fetchBrowseListings } from "~/server/listings/browse.fn";

/**
 * The browse queries' key prefix — every server-page query starts with it, so
 * scoped cache operations (e.g. the map accumulation's failed-page retry) can
 * address the family without restating the literal.
 */
export const BROWSE_LISTINGS_QUERY_KEY = "browse-listings";

/**
 * The browse directory's one React Query definition, shared by the route's
 * loader/suspense read and the map view's extra-page fetches — one cache
 * identity per server page, no bespoke fetch paths.
 *
 * Client-safe: imports only the `*.fn.ts` server-fn seam and pure listing
 * modules.
 */
export function browseQueryOptions(
  page: number,
  attrs: ClaimAttribute[],
  sort: BrowseSort,
  coords: UserCoords | undefined,
  q: string,
  radius: number,
  saved: boolean,
  quick: QuickFilterValue[],
  bot: boolean,
  area: UserCoords | undefined
) {
  // The distance-sort anchor. An active area search ("Search near here")
  // re-anchors the ordering and the per-card "0.4 mi" labels on the searched
  // spot, composed entirely client-side from the server's existing inputs:
  // the area coords ride in as the sort coords, so page 1 of an area search
  // is the closest-to-that-spot page and its labels read from the spot, not
  // from wherever the visitor is standing. Without an area, the browser
  // reading anchors as before; without either, the server anchors on the
  // request's coarse location or degrades to the fallback order. Coords are
  // threaded only when actually distance-sorting.
  const anchor = sort === "distance" ? (area ?? coords) : undefined;
  const anchorLat = anchor?.lat;
  const anchorLng = anchor?.lng;
  // Normalize the free-text query for the cache key so `""` and whitespace share
  // one cache entry (the server treats a blank query as "no text constraint").
  const trimmedQ = q.trim();
  return queryOptions({
    // The radius filter changes the result set + honest total, so it is part
    // of a page's identity.
    //
    // This key's shape is load-bearing beyond caching: the map view's
    // "Load more" accumulation uses the base page's hashed key as its
    // result-set identity (use-map-pages.ts), so anything that changes what
    // the server returns must appear here — a param that changes the response
    // but not the key would leave stale accumulated pins standing.
    queryKey: [
      BROWSE_LISTINGS_QUERY_KEY,
      page,
      attrs,
      sort,
      anchorLat ?? null,
      anchorLng ?? null,
      trimmedQ,
      radius,
      // The saved filter changes the result set and makes the response
      // viewer-specific, so it's part of a page's identity — the saved and
      // unsaved views cache independently.
      saved,
      // The quick-filter set changes the result set + honest total, so a
      // `?quick=` view caches independently. An empty set shares one cache
      // entry; React Query hashes the array structurally.
      quick,
      // Curator-bot participation (`?bot=`) changes the result set + honest
      // total, so it is part of a page's identity.
      bot,
      // The area-search origin (`?areaLat=`/`?areaLng=`) re-anchors the
      // radius filter, so each searched area caches independently.
      area?.lat ?? null,
      area?.lng ?? null,
    ],
    queryFn: () =>
      fetchBrowseListings({
        data: {
          page,
          pageSize: BROWSE_PAGE_SIZE,
          attrs,
          sort,
          userLat: anchorLat,
          userLng: anchorLng,
          q: trimmedQ,
          // Distance-radius filter: keep only listings within `radius` mi of
          // the origin. Independent of the sort anchor above.
          radiusMiles: radius,
          // Server-side "Saved" filter: when set, the server constrains to
          // the viewer's favorites before paginating (honest total/hasMore).
          savedOnly: saved,
          // Quick filters: a faceted set of server-side constraints on the
          // displayed safety glance. Empty set → no quick constraint.
          quick,
          // Curator-bot participation: false reverts filters to
          // community-evidence-only matching and hides bot-suggested-only
          // listings from the results.
          includeSuggested: bot,
          // The searched spot overrides the radius origin. The server already
          // accepts an explicit origin for the radius predicate; absent, it
          // falls back through the sort anchor to Union Station.
          originLat: area?.lat,
          originLng: area?.lng,
        },
      }),
  });
}
