import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowseListingCard } from "~/server/listings/browse";

/**
 * Tests for the client `viewerFavoritesQuery` options (issue AUB-127 / F9).
 *
 * The query's only dependency is the client-safe `favorites.fn` seam, which we
 * mock so we can assert the options' shape and that resolving the query delegates
 * to `fetchViewerFavorites` — without touching cookies or a DB. We drive the query
 * through a real `QueryClient` (as the route loader does via `ensureQueryData`).
 * The server fn's anon short-circuit + card-building is covered in
 * `server/favorites/index.test.ts`; here we mock its resolved value.
 */
const fetchViewerFavoritesMock = vi.fn<() => Promise<BrowseListingCard[]>>(() =>
  Promise.resolve([])
);
vi.mock("~/server/favorites/favorites.fn", () => ({
  fetchViewerFavorites: () => fetchViewerFavoritesMock(),
}));

import { viewerFavoritesQuery } from "./viewer-favorites-query";

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("viewerFavoritesQuery", () => {
  it("is keyed on ['viewer-favorites']", () => {
    expect(viewerFavoritesQuery.queryKey).toEqual(["viewer-favorites"]);
  });

  it("resolves via fetchViewerFavorites", async () => {
    const card = { favoriteCount: 2 } as BrowseListingCard;
    fetchViewerFavoritesMock.mockResolvedValueOnce([card]);

    const result = await newClient().ensureQueryData(viewerFavoritesQuery);

    expect(fetchViewerFavoritesMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([card]);
  });

  it("resolves to [] for an anonymous viewer (server fn short-circuits, no DB)", async () => {
    fetchViewerFavoritesMock.mockResolvedValueOnce([]);

    const result = await newClient().ensureQueryData(viewerFavoritesQuery);

    expect(result).toEqual([]);
  });
});
