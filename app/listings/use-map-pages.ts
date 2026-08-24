import { type UseQueryResult, useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { BROWSE_LISTINGS_QUERY_KEY, type browseQueryOptions } from "~/listings/browse-query";
import { MAX_MAP_EXTRA_PAGES } from "~/listings/browse-search";
import type { BrowseListingCard, BrowseListingsPage } from "~/server/listings/browse";

/**
 * Accumulated "Load more" pages for the directory Map view: this hook owns
 * fetching the extra pages, merging them with the base page, and the carousel
 * card's wiring, so the route makes one call.
 *
 * The URL owns the count (docs/agents/url-state.md): `extraPages` is the
 * validated `?pages=` param and `onAdvance` writes the next count back to it,
 * so the hook holds no page-count state of its own. Because the result-set
 * params and `?pages=` travel in the same URL, Back/forward and a pasted link
 * restore the accumulation coherently, and a result-set change resets it by
 * stripping the param at the navigation that changes the set. Extra pages
 * mount as one `useQueries` batch, so a URL-seeded count fetches every page
 * in parallel — never a waterfall.
 */

/**
 * The carousel's "Load more" wiring. The card renders while a further page
 * exists, one is in flight, or the last request failed; it hides for good
 * once everything is loaded.
 */
export interface MapLoadMore {
  /** A further page exists after the loaded ones (honest total, capped). */
  hasNext: boolean;
  /** A page is being fetched — the card shows its busy state. */
  pending: boolean;
  /**
   * A page request failed. The card offers a retry, and `onLoadMore` retries
   * the failed page instead of appending past the hole.
   */
  failed: boolean;
  onLoadMore: () => void;
}

type BrowsePageQueryOptions = ReturnType<typeof browseQueryOptions>;

/** One fetched page's contribution to the merged card list. */
interface FetchedPage {
  cards: BrowseListingCard[];
  /** When this copy of the data was fetched (freshest copy wins a dedupe). */
  updatedAt: number;
}

/**
 * Collapse the extra-page query results to one stable value. Module-level so
 * `useQueries` can memoize its output — a fresh function per render would
 * defeat that and churn the map entries' identity every render.
 *
 * `pending` is "a page with no data yet is fetching": first loads and error
 * retries show the busy card, background revalidation of an already-shown
 * page does not.
 */
function combineExtraPages(results: UseQueryResult<BrowseListingsPage>[]): {
  pages: FetchedPage[];
  pending: boolean;
  failed: boolean;
} {
  return {
    pages: results.flatMap((result) =>
      result.data ? [{ cards: result.data.cards, updatedAt: result.dataUpdatedAt }] : []
    ),
    pending: results.some((result) => !result.data && result.isFetching),
    failed: results.some((result) => result.isError),
  };
}

/**
 * Merge pages into one card list, deduped by listing id. Position-stable: the
 * first occurrence keeps its slot, so the pin/card numbering (derived from
 * array order) never reshuffles under a dedupe. Content-fresh: when the same
 * listing appears on two pages (the underlying data shifted mid-
 * accumulation), the more recently fetched copy fills that slot — a newer
 * safety signal must never lose to a stale duplicate.
 */
function mergePages(pages: FetchedPage[]): BrowseListingCard[] {
  const slots: BrowseListingCard[] = [];
  const slotById = new Map<string, number>();
  const freshnessById = new Map<string, number>();
  for (const page of pages) {
    for (const card of page.cards) {
      const id = card.listing.id;
      const slot = slotById.get(id);
      if (slot === undefined) {
        slotById.set(id, slots.length);
        freshnessById.set(id, page.updatedAt);
        slots.push(card);
      } else if (page.updatedAt > (freshnessById.get(id) ?? 0)) {
        slots[slot] = card;
        freshnessById.set(id, page.updatedAt);
      }
    }
  }
  return slots;
}

export function useMapPages({
  active,
  page,
  pageSize,
  total,
  base,
  optionsForPage,
  extraPages: requestedExtraPages,
  onAdvance,
}: {
  /** Whether the map view is showing — extra pages only fetch while it is. */
  active: boolean;
  /** The base page (the URL's `?page=`), which accumulation appends after. */
  page: number;
  pageSize: number;
  /** The honest total under the active filters (same WHERE as the pages). */
  total: number;
  /** The base page's cards and fetch time (from the route's suspense query). */
  base: { cards: BrowseListingCard[]; updatedAt: number };
  /**
   * Query options for one server page — the same `browseQueryOptions` the
   * route's loader uses, so extra pages share the pager's cache entries (no
   * bespoke fetch path, no duplicate base-page fetch). Must be memoized on
   * every result-set param.
   */
  optionsForPage: (page: number) => BrowsePageQueryOptions;
  /** The URL's `?pages=` count (0 when absent). Clamped below to what the
   * honest total supports, so a stale link never fetches pages past the end. */
  extraPages: number;
  /** Advance `?pages=` by one (a `replace` navigate at the route). Must be
   * identity-stable — it feeds the memoized `loadMore` value. */
  onAdvance: () => void;
}): { cards: BrowseListingCard[]; loadMore: MapLoadMore } {
  const queryClient = useQueryClient();

  // Clamp to the cap and to the pages the honest total actually holds: the
  // `hasNext` math below must stay exact when a restored `?pages=` outruns a
  // result set that shrank since the link was made.
  const lastPage = Math.ceil(total / pageSize);
  const extraPages = Math.max(
    0,
    Math.min(requestedExtraPages, MAX_MAP_EXTRA_PAGES, lastPage - page)
  );

  const queries = useMemo(
    () =>
      Array.from({ length: extraPages }, (_, i) => ({
        ...optionsForPage(page + 1 + i),
        // Fetch only while the map view is showing; already-fetched pages
        // stay cached across a List round trip.
        enabled: active,
        // Extra pages only: a focus/reconnect revalidation of every
        // accumulated page at once is wasted load for pins that are already
        // on screen. The base page keeps the app-wide defaults.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      })),
    [extraPages, page, active, optionsForPage]
  );
  const extra = useQueries({ queries, combine: combineExtraPages });

  const cards = useMemo(() => {
    if (extra.pages.length === 0) {
      return base.cards;
    }
    return mergePages([{ cards: base.cards, updatedAt: base.updatedAt }, ...extra.pages]);
  }, [base.cards, base.updatedAt, extra.pages]);

  const hasNext = extraPages < MAX_MAP_EXTRA_PAGES && (page + extraPages) * pageSize < total;

  const { pending, failed } = extra;
  const onLoadMore = useCallback(() => {
    if (pending) return;
    if (failed) {
      // Retry the failed page(s) rather than appending past the hole. The
      // failed extra pages are the active errored browse queries; scoping by
      // key prefix + active keeps this from touching unrelated caches.
      void queryClient.refetchQueries({
        queryKey: [BROWSE_LISTINGS_QUERY_KEY],
        type: "active",
        predicate: (query) => query.state.status === "error",
      });
      return;
    }
    if (!hasNext) return;
    onAdvance();
  }, [pending, failed, queryClient, hasNext, onAdvance]);

  const loadMore = useMemo<MapLoadMore>(
    () => ({ hasNext, pending, failed, onLoadMore }),
    [hasNext, pending, failed, onLoadMore]
  );

  return { cards, loadMore };
}
