import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, useCallback, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browseQueryOptions } from "~/listings/browse-query";
import { MAX_MAP_EXTRA_PAGES } from "~/listings/browse-search";
import type { BrowseListingCard, BrowseListingsPage } from "~/server/listings/browse";
import { useMapPages } from "./use-map-pages";

// The hook is exercised against the real browseQueryOptions (so extra pages
// share the pager's real cache identities) with the server-fn seam mocked:
// each test scripts what any page fetch returns via `fetchImpl`.
const fetchMock = vi.hoisted(() => ({
  impl: (page: number): Promise<BrowseListingsPage> => Promise.resolve(pageResponse(page, [])),
  calls: [] as number[],
}));
vi.mock("~/server/listings/browse.fn", () => ({
  fetchBrowseListings: vi.fn(({ data }: { data: { page: number } }) => {
    fetchMock.calls.push(data.page);
    return fetchMock.impl(data.page);
  }),
}));

/** A minimal browse card — the hook only reads `listing.id` (plus whatever
 * the merge carries through verbatim, asserted via `hasRecentIncident`). */
function card(id: string, hasRecentIncident = false): BrowseListingCard {
  return {
    listing: { id },
    glance: { hasRecentIncident },
    favoriteCount: 0,
  } as unknown as BrowseListingCard;
}

function pageResponse(page: number, cards: BrowseListingCard[]): BrowseListingsPage {
  return { cards, page } as unknown as BrowseListingsPage;
}

function pageOptions(page: number, radius = 25) {
  return browseQueryOptions(page, [], "alpha", undefined, "", radius, false, [], true, undefined);
}

/**
 * Renders the hook behind a stand-in for the route's URL wiring: the
 * `?pages=` count lives in harness state outside the hook (the URL is the one
 * source of the count), `onAdvance` moves it forward exactly like the route's
 * replace navigate, and `setPages` plays the URL changing from elsewhere
 * (Back/forward, a pasted link, a result-set change stripping the param).
 */
function renderMapPages(
  initial: { radius?: number; active?: boolean; pages?: number; total?: number } = {},
  base: BrowseListingCard[] = [card("a1"), card("a2")]
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    ({ radius, active, total }: { radius: number; active: boolean; total: number }) => {
      const [pages, setPages] = useState(initial.pages ?? 0);
      const onAdvance = useCallback(() => {
        setPages((prev) => Math.min(prev + 1, MAX_MAP_EXTRA_PAGES));
      }, []);
      const result = useMapPages({
        active,
        page: 1,
        pageSize: 2,
        total,
        base: { cards: base, updatedAt: 1 },
        optionsForPage: (pageToLoad: number) => pageOptions(pageToLoad, radius),
        extraPages: pages,
        onAdvance,
      });
      return { ...result, pages, setPages };
    },
    {
      wrapper,
      initialProps: {
        radius: initial.radius ?? 25,
        active: initial.active ?? true,
        total: initial.total ?? 100,
      },
    }
  );
}

beforeEach(() => {
  fetchMock.calls = [];
  fetchMock.impl = (page) => Promise.resolve(pageResponse(page, [card(`p${page}-1`)]));
});

describe("useMapPages — appending", () => {
  it("starts at the base page; Load more advances the count and appends in order", async () => {
    const { result } = renderMapPages();
    expect(result.current.cards.map((c) => c.listing.id)).toEqual(["a1", "a2"]);
    expect(result.current.loadMore.hasNext).toBe(true);

    act(() => result.current.loadMore.onLoadMore());
    // Load more's only state write is the advanced count (the route turns it
    // into a `?pages=` replace navigate)…
    expect(result.current.pages).toBe(1);
    // …the busy state shows while the page fetches…
    expect(result.current.loadMore.pending).toBe(true);
    // …and the appended cards land after the base page, preserving order
    // (numbering derives from array order downstream).
    await waitFor(() => expect(result.current.loadMore.pending).toBe(false));
    expect(result.current.cards.map((c) => c.listing.id)).toEqual(["a1", "a2", "p2-1"]);
    expect(fetchMock.calls).toEqual([2]);
  });

  it("ignores loadMore while a page is already in flight (no double advance)", async () => {
    const { result } = renderMapPages();
    act(() => result.current.loadMore.onLoadMore());
    act(() => result.current.loadMore.onLoadMore());
    await waitFor(() => expect(result.current.loadMore.pending).toBe(false));
    expect(result.current.pages).toBe(1);
    expect(fetchMock.calls).toEqual([2]);
  });

  it("stops offering pages at the accumulation cap", async () => {
    const { result } = renderMapPages();
    for (let i = 0; i < MAX_MAP_EXTRA_PAGES; i++) {
      act(() => result.current.loadMore.onLoadMore());
      await waitFor(() => expect(result.current.loadMore.pending).toBe(false));
    }
    // total (100) still holds more, but the cap bounds the map's pin count.
    expect(result.current.cards).toHaveLength(2 + MAX_MAP_EXTRA_PAGES);
    expect(result.current.loadMore.hasNext).toBe(false);
    act(() => result.current.loadMore.onLoadMore());
    await waitFor(() => expect(result.current.loadMore.pending).toBe(false));
    expect(result.current.pages).toBe(MAX_MAP_EXTRA_PAGES);
    expect(fetchMock.calls).toEqual([2, 3, 4, 5, 6]);
  });

  it("does not fetch extra pages while the map view is inactive", async () => {
    const { result, rerender } = renderMapPages({ active: false });
    act(() => result.current.loadMore.onLoadMore());
    await Promise.resolve();
    expect(fetchMock.calls).toEqual([]);
    // Switching to the map view starts the fetch.
    rerender({ radius: 25, active: true, total: 100 });
    await waitFor(() => expect(result.current.cards).toHaveLength(3));
    expect(fetchMock.calls).toEqual([2]);
  });
});

describe("useMapPages — URL-seeded hydration", () => {
  it("fetches every seeded extra page in parallel and merges all of them", async () => {
    // Deferred fetches: both requests must be in flight together before
    // either resolves — a restored `?pages=` never loads as a waterfall.
    const resolvers = new Map<number, (page: BrowseListingsPage) => void>();
    fetchMock.impl = (page) =>
      new Promise((resolve) => {
        resolvers.set(page, resolve);
      });
    const { result } = renderMapPages({ pages: 2 });
    expect([...fetchMock.calls].sort()).toEqual([2, 3]);
    expect(result.current.loadMore.pending).toBe(true);
    act(() => {
      resolvers.get(2)?.(pageResponse(2, [card("p2-1")]));
      resolvers.get(3)?.(pageResponse(3, [card("p3-1")]));
    });
    await waitFor(() =>
      expect(result.current.cards.map((c) => c.listing.id)).toEqual(["a1", "a2", "p2-1", "p3-1"])
    );
  });

  it("clamps a seeded count past what the honest total supports (hasNext stays exact)", async () => {
    // total 4 at pageSize 2 = two pages; a stale link asking for five extra
    // pages fetches only the one that exists.
    const { result } = renderMapPages({ pages: 5, total: 4 });
    await waitFor(() => expect(result.current.cards).toHaveLength(3));
    expect(fetchMock.calls).toEqual([2]);
    expect(result.current.loadMore.hasNext).toBe(false);
  });

  it("clamps a count past the accumulation cap", async () => {
    const { result } = renderMapPages({ pages: 99 });
    await waitFor(() => expect(result.current.loadMore.pending).toBe(false));
    expect(fetchMock.calls).toEqual([2, 3, 4, 5, 6]);
    expect(result.current.cards).toHaveLength(2 + MAX_MAP_EXTRA_PAGES);
    expect(result.current.loadMore.hasNext).toBe(false);
  });

  it("keeps a seeded page pending while its fetch is not yet dispatched (real-browser idle window)", async () => {
    // A real device holds an enabled, dataless query in a non-fetching state
    // (fetchStatus "paused" on a connectivity blip, or before the dispatch).
    // The unresolved signal must not read settled in that window: consumers
    // (the stale-sel strip, the restore wait, the busy card) would judge the
    // restored URL against a set that is still missing its pages.
    onlineManager.setOnline(false);
    try {
      const { result } = renderMapPages({ pages: 1 });
      // Let the mount's optimistic fetch state settle into the paused,
      // not-fetching reality before asserting.
      await act(async () => {});
      expect(result.current.cards).toHaveLength(2);
      expect(result.current.loadMore.pending).toBe(true);

      // Connectivity returns: the fetch dispatches and delivers, and only
      // then does the page count as resolved.
      act(() => onlineManager.setOnline(true));
      await waitFor(() =>
        expect(result.current.cards.map((c) => c.listing.id)).toEqual(["a1", "a2", "p2-1"])
      );
      expect(result.current.loadMore.pending).toBe(false);
    } finally {
      onlineManager.setOnline(true);
    }
  });
});

describe("useMapPages — the URL owns the count", () => {
  it("resets with the stripped count on a result-set change, and a Back restore refills from cache", async () => {
    const { result, rerender } = renderMapPages();
    act(() => result.current.loadMore.onLoadMore());
    await waitFor(() => expect(result.current.cards).toHaveLength(3));

    // A result-set change (different radius) strips `?pages=` in the same
    // navigation — the count and the set always travel together.
    act(() => result.current.setPages(0));
    rerender({ radius: 10, active: true, total: 100 });
    expect(result.current.cards.map((c) => c.listing.id)).toEqual(["a1", "a2"]);

    // Back restores radius and count from one URL: the accumulated page
    // fills straight from cache.
    act(() => result.current.setPages(1));
    rerender({ radius: 25, active: true, total: 100 });
    await waitFor(() =>
      expect(result.current.cards.map((c) => c.listing.id)).toEqual(["a1", "a2", "p2-1"])
    );
  });
});

describe("useMapPages — dedupe", () => {
  it("keeps the first occurrence's slot but the freshest copy's content for a duplicate", async () => {
    // The same listing slid from the base page onto page 2 (data shifted
    // mid-accumulation), and the later fetch carries a NEW recent incident.
    fetchMock.impl = (page) =>
      Promise.resolve(pageResponse(page, [card("a2", true), card("p2-1")]));
    const { result } = renderMapPages();
    act(() => result.current.loadMore.onLoadMore());
    await waitFor(() => expect(result.current.cards).toHaveLength(3));

    // Position-stable: a2 keeps slot 2 (numbering never reshuffles) — no
    // duplicate entry…
    expect(result.current.cards.map((c) => c.listing.id)).toEqual(["a1", "a2", "p2-1"]);
    // …and content-fresh: the newer copy's incident flag wins. A newer
    // safety signal must never lose to a stale duplicate.
    const a2 = result.current.cards[1] as unknown as { glance: { hasRecentIncident: boolean } };
    expect(a2.glance.hasRecentIncident).toBe(true);
  });
});

describe("useMapPages — failed pages", () => {
  it("reports failure, blocks appending past the hole, and loadMore retries instead", async () => {
    fetchMock.impl = () => Promise.reject(new Error("network down"));
    const { result } = renderMapPages();
    act(() => result.current.loadMore.onLoadMore());
    await waitFor(() => expect(result.current.loadMore.failed).toBe(true));
    expect(result.current.cards).toHaveLength(2);
    expect(fetchMock.calls).toEqual([2]);

    // While failed, loadMore must not append page 3 past the hole — it
    // retries the failed page, and the count stays where it was.
    fetchMock.impl = (page) => Promise.resolve(pageResponse(page, [card(`p${page}-1`)]));
    act(() => result.current.loadMore.onLoadMore());
    await waitFor(() => expect(result.current.loadMore.failed).toBe(false));
    expect(result.current.pages).toBe(1);
    expect(result.current.cards.map((c) => c.listing.id)).toEqual(["a1", "a2", "p2-1"]);
    expect(fetchMock.calls).toEqual([2, 2]);
  });
});
