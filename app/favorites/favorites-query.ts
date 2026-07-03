import { queryOptions } from "@tanstack/react-query";
import { fetchViewerFavoriteIds } from "~/server/favorites/favorites.fn";

/**
 * Shared `queryOptions` for "which listings has the viewer favorited" (issue
 * AUB-122 / F4). Lives in its own module so both the root loader (which
 * prefetches via `ensureQueryData`) and the components that render the favorite
 * state (`useSuspenseQuery`) can import it without a circular import back
 * through `__root.tsx`.
 *
 * Imports only the client-safe `favorites.fn` seam (the `*.fn.ts` convention)
 * plus `@tanstack/react-query`, never `~/server/favorites/index`, so no
 * db/drizzle runtime leaks into the client bundle. The underlying server fn
 * short-circuits anonymous callers to `[]` with no DB hit.
 */
export const favoriteIdsQuery = queryOptions({
  queryKey: ["favorites"],
  queryFn: () => fetchViewerFavoriteIds(),
});
