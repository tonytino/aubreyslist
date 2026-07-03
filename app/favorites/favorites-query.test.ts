import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the client `favoriteIdsQuery` options (issue AUB-122 / F4).
 *
 * The query's only dependency is the client-safe `favorites.fn` seam, which we
 * mock so we can assert the options' shape and that resolving the query
 * delegates to `fetchViewerFavoriteIds` — without touching cookies or a DB. We
 * drive the query through a real `QueryClient` (as the root loader does via
 * `ensureQueryData`), which is closer to production than poking `queryFn`
 * directly. The server fn's own anon-short-circuit + visibility filtering is
 * covered in `server/favorites/index.test.ts`; here we mock its resolved value
 * to cover the anonymous (`[]`) and signed-in (id set) outcomes.
 */

const fetchViewerFavoriteIdsMock = vi.fn<() => Promise<string[]>>(() => Promise.resolve([]));
vi.mock("~/server/favorites/favorites.fn", () => ({
  fetchViewerFavoriteIds: () => fetchViewerFavoriteIdsMock(),
}));

import { favoriteIdsQuery } from "./favorites-query";

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("favoriteIdsQuery", () => {
  it("is keyed on ['favorites']", () => {
    expect(favoriteIdsQuery.queryKey).toEqual(["favorites"]);
  });

  it("resolves via fetchViewerFavoriteIds", async () => {
    fetchViewerFavoriteIdsMock.mockResolvedValueOnce(["listing-1"]);

    const result = await newClient().ensureQueryData(favoriteIdsQuery);

    expect(fetchViewerFavoriteIdsMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(["listing-1"]);
  });

  it("resolves to [] for an anonymous viewer (server fn short-circuits, no DB)", async () => {
    fetchViewerFavoriteIdsMock.mockResolvedValueOnce([]);

    const result = await newClient().ensureQueryData(favoriteIdsQuery);

    expect(result).toEqual([]);
  });

  it("resolves to the viewer's favorited id set when signed in", async () => {
    fetchViewerFavoriteIdsMock.mockResolvedValueOnce(["listing-1", "listing-2", "listing-3"]);

    const result = await newClient().ensureQueryData(favoriteIdsQuery);

    expect(result).toEqual(["listing-1", "listing-2", "listing-3"]);
  });
});
