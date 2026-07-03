import { queryOptions } from "@tanstack/react-query";
import { fetchViewerFavorites } from "~/server/favorites/favorites.fn";

/**
 * Shared `queryOptions` for "the viewer's saved listings as browse cards" (issue
 * AUB-127 / F9) — the data behind the `/favorites` page. Lives in its own module
 * so both the route loader (which prefetches via `ensureQueryData`) and the page
 * component (`useSuspenseQuery`) can import it without a circular import.
 *
 * Mirrors `favorites-query.ts`: imports ONLY the client-safe `favorites.fn` seam
 * (the `*.fn.ts` convention) plus `@tanstack/react-query`, never
 * `~/server/favorites/index`, so no db/drizzle runtime leaks into the client
 * bundle. The underlying server fn short-circuits anonymous callers to `[]` with
 * no DB hit.
 */
export const viewerFavoritesQuery = queryOptions({
  queryKey: ["viewer-favorites"],
  queryFn: () => fetchViewerFavorites(),
});
