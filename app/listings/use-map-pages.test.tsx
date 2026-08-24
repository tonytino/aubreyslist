import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browseQueryOptions } from "~/listings/browse-query";
import type { BrowseListingCard, BrowseListingsPage } from "~/server/listings/browse";
import { MAX_MAP_EXTRA_PAGES, useMapPages } from "./use-map-pages";

// The hook is exercised against the real browseQueryOptions (so the reset
// identity is the real query key) with the server-fn seam mocked: each test
// scripts what any page fetch returns via `fetchImpl`.
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

function renderMapPages(
  initial: { radius?: number; active?: boolean } = {},
  base: BrowseListingCard[] = [card("a1"), card("a2")]
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    ({ radius, active }: { radius: number; active: boolean }) =>
      useMapPages({
        active,
        page: 1,
        pageSize: 2,
        total: 100,
        base: { cards: base, updatedAt: 1 },
        // eslint-free stand-in for the route's useCallback: a stable closure
        // per rerender props, exactly like the route's memoized builder.
        optionsForPage: (pageToLoad: number) => pageOptions(pageToLoad, radius),
      }),
    { wrapper, initialProps: { radius: initial.radius ?? 25, active: initial.active ?? true } }
  );
}

beforeEach(() => {
  fetchMock.calls = [];
  fetchMock.impl = (page) => Promise.resolve(pageResponse(page, [card(`p${page}-1`)]));
});

describe("useMapPages — appending", () => {
  it("starts at the base page and appends the next page's cards in order", async () => {
    const { result } = renderMapPages();
    expect(result.current.cards.map((c) => c.listing.id)).toEqual(["a1", "a2"]);
    expect(result.current.loadMore.hasNext).toBe(true);

    act(() => result.current.loadMore.onLoadMore());
    // The busy state shows while the page fetches…
    expect(result.current.loadMore.pending).toBe(true);
    // …and the appended cards land after the base page, preserving order
    // (numbering derives from array order downstream).
    await waitFor(() => expect(result.current.loadMore.pending).toBe(false));
    expect(result.current.cards.map((c) => c.listing.id)).toEqual(["a1", "a2", "p2-1"]);
    expect(fetchMock.calls).toEqual([2]);
  });

  it("ignores loadMore while a page is already in flight (no double append)", async () => {
    const { result } = renderMapPages();
    act(() => result.current.loadMore.onLoadMore());
    act(() => result.current.loadMore.onLoadMore());
    await waitFor(() => expect(result.current.loadMore.pending).toBe(false));
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
    expect(fetchMock.calls).toEqual([2, 3, 4, 5, 6]);
  });

  it("does not fetch extra pages while the map view is inactive", async () => {
    const { result, rerender } = renderMapPages({ active: false });
    act(() => result.current.loadMore.onLoadMore());
    await Promise.resolve();
    expect(fetchMock.calls).toEqual([]);
    // Switching to the map view starts the fetch.
    rerender({ radius: 25, active: true });
    await waitFor(() => expect(result.current.cards).toHaveLength(3));
    expect(fetchMock.calls).toEqual([2]);
  });
});

describe("useMapPages — reset on result-set change", () => {
  it("resets to zero when the result set changes, and an A→B→A round trip stays reset", async () => {
    const { result, rerender } = renderMapPages({ radius: 25 });
    act(() => result.current.loadMore.onLoadMore());
    await waitFor(() => expect(result.current.cards).toHaveLength(3));

    // A different radius is a different result set: accumulation resets.
    rerender({ radius: 10, active: true });
    expect(result.current.cards.map((c) => c.listing.id)).toEqual(["a1", "a2"]);

    // Returning to the original result set must NOT resurrect the old count —
    // the reset writes through to state, it isn't just masked at read time.
    rerender({ radius: 25, active: true });
    expect(result.current.cards.map((c) => c.listing.id)).toEqual(["a1", "a2"]);
    await Promise.resolve();
    expect(result.current.cards.map((c) => c.listing.id)).toEqual(["a1", "a2"]);
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
    // retries the failed page.
    fetchMock.impl = (page) => Promise.resolve(pageResponse(page, [card(`p${page}-1`)]));
    act(() => result.current.loadMore.onLoadMore());
    await waitFor(() => expect(result.current.loadMore.failed).toBe(false));
    expect(result.current.cards.map((c) => c.listing.id)).toEqual(["a1", "a2", "p2-1"]);
    expect(fetchMock.calls).toEqual([2, 2]);
  });
});
