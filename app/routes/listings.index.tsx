import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { AddSpotFab } from "~/components/directory/AddSpotFab";
import { DirectoryHeader } from "~/components/directory/DirectoryHeader";
import { DirectoryList } from "~/components/directory/DirectoryList";
import { DirectoryMap, type DirectoryMapEntry } from "~/components/directory/DirectoryMap";
import { DirectorySearch } from "~/components/directory/DirectorySearch";
import {
  DirectoryEmpty,
  DirectoryNoResults,
  LoadingSkeletons,
} from "~/components/directory/DirectoryStates";
import { FilterChips } from "~/components/directory/FilterChips";
import { type DirectoryView, ViewToggle } from "~/components/directory/ViewToggle";
import { type QuickFilter, filterByQuick } from "~/components/directory/filtering";
import { listingToCardVM } from "~/components/listing/ListingCard";
import {
  BROWSE_PAGE_SIZE,
  type UserCoords,
  coordsFromSearch,
  parseAttrs,
  serializeAttrs,
} from "~/listings/browse-params";
import {
  BROWSE_SORT_OPTIONS,
  BROWSE_SORT_VALUES,
  type BrowseSort,
  DEFAULT_BROWSE_SORT,
} from "~/listings/sort";
import type { ClaimAttribute } from "~/listings/taxonomy";
import { useGeolocation } from "~/listings/use-geolocation";
import type { BrowseListingsPage } from "~/server/listings/browse";
import { fetchBrowseListings } from "~/server/listings/browse.fn";

/**
 * The Denver restaurant directory — the default discovery screen (domain.md →
 * Discovery, "list-first"), rebuilt to the AUB-61 Claude Design bundle
 * (Phase 2b). Open to anonymous visitors (reads are open).
 *
 * DATA PATTERN — PRESERVED. The page number and the GF taxonomy filter still live
 * in the URL (`?page=`, `?attrs=`, `?sort=`, `?lat=`/`?lng=`), so the
 * server-filtered, SSR-prefetched view stays linkable/shareable and back/forward
 * works. Data is prefetched in the loader and read via `useSuspenseQuery`, so it
 * dehydrates into the SSR HTML and hydrates with no loading flash
 * (docs/agents/api.md). The trust glance + consensus taxonomy filter are computed
 * server-side (one batched query set) by `fetchBrowseListings`.
 *
 * BUNDLE LAYER — CLIENT-SIDE. On top of that server page, the redesign adds
 * INSTANT client-side affordances over the ALREADY-LOADED page: a search field
 * (name + address substring, no shimmer) and three mutually-exclusive "quick"
 * chips (celiac / gluten-friendly / recently-verified) that DO flash the bundle's
 * ~430ms loading shimmer. The real, server-side taxonomy filter is untouched — it
 * lives behind the "Filters" chip's sheet and still drives `?attrs=`.
 */

const browseSearchSchema = z.object({
  page: z.number().int().min(1).catch(1),
  /** Comma-separated taxonomy attributes (#35); defaults to "" (no filter). */
  attrs: z.string().catch("").default(""),
  // Free-text search over name + address (#34). URL-driven like page/attrs/sort so
  // the search is SERVER-COMPLETE (covers ALL listings, not just the loaded page),
  // linkable/shareable, and back/forward-correct. Empty string → no text
  // constraint. Bounded to the server's accepted length; garbage degrades to "".
  q: z.string().max(256).catch("").default(""),
  // `?sort=` mirrors the `?page=` URL-param pattern (#36): linkable, back/forward
  // works. A plain enum (NOT a `.transform()`) so the value round-trips cleanly
  // when the router re-serializes search state on navigation; unknown/garbage
  // tokens degrade to the stable alphabetical default via `.catch`.
  sort: z.enum(BROWSE_SORT_VALUES as [BrowseSort, ...BrowseSort[]]).catch(DEFAULT_BROWSE_SORT),
  // The user's location for the "near me" distance sort (#37), kept in the URL
  // (so a distance-sorted view is linkable/back-forwardable like the rest).
  lat: z.number().finite().min(-90).max(90).optional().catch(undefined),
  lng: z.number().finite().min(-180).max(180).optional().catch(undefined),
});

function browseQueryOptions(
  page: number,
  attrs: ClaimAttribute[],
  sort: BrowseSort,
  coords: UserCoords | undefined,
  q: string
) {
  // Only thread coords to the server when actually distance-sorting — a non-pair
  // (or a non-distance sort) means no coords, and the server falls back to the
  // alphabetical default. Including coords in the key keeps separate-location
  // results cached independently.
  const userLat = sort === "distance" ? coords?.lat : undefined;
  const userLng = sort === "distance" ? coords?.lng : undefined;
  // Normalize the free-text query for the cache key so `""` and whitespace share
  // one cache entry (the server treats a blank query as "no text constraint").
  const trimmedQ = q.trim();
  return queryOptions({
    queryKey: ["browse-listings", page, attrs, sort, userLat ?? null, userLng ?? null, trimmedQ],
    queryFn: () =>
      fetchBrowseListings({
        data: { page, pageSize: BROWSE_PAGE_SIZE, attrs, sort, userLat, userLng, q: trimmedQ },
      }),
  });
}

export const Route = createFileRoute("/listings/")({
  validateSearch: browseSearchSchema,
  loaderDeps: ({ search: { page, attrs, sort, lat, lng, q } }) => ({
    page,
    attrs,
    sort,
    lat,
    lng,
    q,
  }),
  loader: async ({ context, deps: { page, attrs, sort, lat, lng, q } }) => {
    await context.queryClient.ensureQueryData(
      browseQueryOptions(page, parseAttrs(attrs), sort, coordsFromSearch(lat, lng), q)
    );
  },
  component: BrowseListings,
});

/** How long the bundle flashes the loading shimmer after a quick-chip change. */
const QUICK_SHIMMER_MS = 430;

/** Debounce before a keystroke is pushed to the URL `?q=` (keeps typing smooth). */
const SEARCH_DEBOUNCE_MS = 275;

function BrowseListings() {
  const { page, attrs: attrsParam, sort, lat, lng, q: qParam } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const attrs = parseAttrs(attrsParam);
  const coords = coordsFromSearch(lat, lng);
  const { data } = useSuspenseQuery(browseQueryOptions(page, attrs, sort, coords, qParam));
  const geo = useGeolocation();

  // Client-side directory state (the bundle layer). Text search is SERVER-side
  // (URL `?q=`); the quick chips filter the current server result set client-side.
  // View + selection are pure UI.
  const [quick, setQuick] = useState<QuickFilter>(null);
  const [view, setView] = useState<DirectoryView>("list");
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The search box is a controlled local input mirrored to the URL `?q=` with a
  // debounce, so typing stays smooth while the SERVER search covers every listing
  // (not just the loaded page). It seeds from the URL so a shared/linked search
  // hydrates correctly, and reconciles if the URL changes underneath it.
  const [searchInput, setSearchInput] = useState(qParam);
  const lastPushedQ = useRef(qParam);
  useEffect(() => {
    // Reconcile local input when the URL `q` changes from elsewhere (link, back/
    // forward, clear-all) and it isn't the value we just pushed.
    if (qParam !== lastPushedQ.current) {
      lastPushedQ.current = qParam;
      setSearchInput(qParam);
    }
  }, [qParam]);

  // Debounce the input → URL navigation (~275ms). A blank/whitespace query is
  // normalized to "" so it round-trips as "no text constraint". Searching resets
  // to page 1 (a page index is meaningless under a new result set) and preserves
  // the active taxonomy filter, sort, and coords.
  useEffect(() => {
    const next = searchInput.trim();
    if (next === qParam.trim()) {
      return;
    }
    const timer = setTimeout(() => {
      lastPushedQ.current = next;
      navigate({ search: { page: 1, attrs: attrsParam, sort, lat, lng, q: next } });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, qParam, attrsParam, sort, lat, lng, navigate]);

  // The full server page as VMs (mapped once, via the shared `listingToCardVM`).
  const allVms = useMemo(
    () => data.cards.map((card) => listingToCardVM(card.listing, card.glance, card.distanceLabel)),
    [data.cards]
  );

  // The subset the directory actually shows — the quick chip refines the server
  // result set client-side (text search already applied server-side).
  const visibleVms = useMemo(() => filterByQuick(allVms, quick), [allVms, quick]);

  // Map entries pair each visible VM with its real coordinates to project (never
  // recomputed — straight from the loaded listing).
  const mapEntries: DirectoryMapEntry[] = useMemo(() => {
    const coordsById = new Map(data.cards.map((card) => [card.listing.id, card.listing]));
    return visibleVms.flatMap((vm) => {
      const listing = coordsById.get(vm.id);
      return listing ? [{ vm, lat: listing.lat, lng: listing.lng }] : [];
    });
  }, [visibleVms, data.cards]);

  // Default the map selection to the first visible entry, and keep the selection
  // valid as the filtered set changes (so a pin never points at a hidden card).
  useEffect(() => {
    if (mapEntries.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    const stillVisible = mapEntries.some((entry) => entry.vm.id === selectedId);
    if (!stillVisible) {
      setSelectedId(mapEntries[0]?.vm.id ?? null);
    }
  }, [mapEntries, selectedId]);

  // A quick-chip change flashes the bundle's ~430ms shimmer to make filtering
  // feel responsive; search does NOT (it must feel instant). The timer is cleared
  // on unmount / re-trigger so it never fires against a stale render.
  const shimmerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function changeQuick(next: QuickFilter) {
    setQuick(next);
    setLoading(true);
    if (shimmerTimer.current) clearTimeout(shimmerTimer.current);
    shimmerTimer.current = setTimeout(() => setLoading(false), QUICK_SHIMMER_MS);
  }
  useEffect(
    () => () => {
      if (shimmerTimer.current) clearTimeout(shimmerTimer.current);
    },
    []
  );

  // Toggling a taxonomy attribute (the REAL server filter) always resets to page
  // 1 and preserves the search query, sort + coords, exactly as before the
  // redesign.
  function toggleAttribute(attribute: ClaimAttribute) {
    const next = attrs.includes(attribute)
      ? attrs.filter((a) => a !== attribute)
      : [...attrs, attribute];
    navigate({ search: { page: 1, attrs: serializeAttrs(next), sort, lat, lng, q: qParam } });
  }

  function clearAttributes() {
    navigate({ search: { page: 1, attrs: "", sort, lat, lng, q: qParam } });
  }

  /**
   * Change the server-side sort (#36/#37), resetting to page 1. "Near me" is
   * special: it requests geolocation only on opt-in and falls back to the default
   * order on denial/unavailable — never a surprise prompt, never a crash.
   */
  function changeSort(next: BrowseSort) {
    if (next !== "distance") {
      geo.reset();
      navigate({
        search: {
          page: 1,
          attrs: attrsParam,
          sort: next,
          lat: undefined,
          lng: undefined,
          q: qParam,
        },
      });
      return;
    }
    void geo.request().then((result) => {
      if (result.status === "success") {
        navigate({
          search: {
            page: 1,
            attrs: attrsParam,
            sort: "distance",
            lat: result.coords.lat,
            lng: result.coords.lng,
            q: qParam,
          },
        });
      } else {
        navigate({
          search: {
            page: 1,
            attrs: attrsParam,
            sort: DEFAULT_BROWSE_SORT,
            lat: undefined,
            lng: undefined,
            q: qParam,
          },
        });
      }
    });
  }

  // The no-results CTA clears EVERYTHING: the client quick chip AND the
  // server-side search + taxonomy filter (resets to page 1 with no `?q=`/`?attrs=`).
  function clearAll() {
    setQuick(null);
    setSearchInput("");
    lastPushedQ.current = "";
    navigate({ search: { page: 1, attrs: "", sort, lat, lng, q: "" } });
  }

  // Whether any filter is active across BOTH layers — decides empty vs no-results.
  // Uses the URL `?q=` (the server-applied search), not the in-flight local input.
  const anyFilterActive = qParam.trim() !== "" || quick !== null || attrs.length > 0;

  // Honest counts. `data.total` is the SERVER total AFTER search + taxonomy filter
  // (the count query shares the same WHERE), so it reflects EVERY matching listing
  // — never just the loaded page. When a quick chip is active it refines the shown
  // results client-side, so we present that as a count of the results shown, never
  // as the grand total (honesty: it hasn't filtered the whole table).
  const quickActive = quick !== null;

  return (
    <div className="mx-auto flex h-[calc(100dvh-var(--site-header-h,3.5rem))] w-full max-w-[428px] flex-col md:max-w-3xl xl:max-w-6xl">
      {/* Sticky header: location · wordmark · community, then search + chips +
          count/view row. `flex-none` so the scroll happens in the content area. */}
      <div className="flex-none border-b border-border bg-surface">
        <DirectoryHeader />
        <div className="flex flex-col gap-3 px-gutter pb-3">
          <DirectorySearch value={searchInput} onChange={setSearchInput} />
          <FilterChips
            attrs={attrs}
            onToggleAttr={toggleAttribute}
            onClearAttrs={clearAttributes}
            quick={quick}
            onQuickChange={changeQuick}
            sheetExtras={
              <DirectoryServerControls
                sort={sort}
                onSortChange={changeSort}
                prompting={geo.status === "prompting"}
                geoError={geo.error}
                data={data}
                attrsParam={attrsParam}
                coords={coords}
              />
            }
          />
          <div className="flex items-center justify-between gap-3">
            {quickActive ? (
              // A quick chip refines only the SHOWN results client-side, so we
              // never claim this is the full total — honest phrasing.
              <p className="text-body-sm text-muted-foreground">
                <span className="font-bold text-foreground">{visibleVms.length}</span> of{" "}
                {data.total} shown match
              </p>
            ) : (
              // The honest SERVER total after search + taxonomy filter — every
              // matching listing across all pages, not just this page.
              <p className="text-body-sm text-muted-foreground">
                <span className="font-bold text-foreground">{data.total}</span> places near{" "}
                <span className="font-semibold text-brand-strong">Denver</span>
              </p>
            )}
            <ViewToggle view={view} onChange={setView} />
          </div>
        </div>
      </div>

      {/* Content area — renders exactly ONE state. Scrollable; the FAB floats over
          it. `relative` so the absolutely-positioned map + FAB anchor here. */}
      <div className="relative flex-1 overflow-y-auto bg-background px-gutter pt-4">
        {loading ? (
          <LoadingSkeletons />
        ) : visibleVms.length === 0 ? (
          anyFilterActive ? (
            <DirectoryNoResults onClearAll={clearAll} />
          ) : (
            <DirectoryEmpty onBrowseCeliac={() => changeQuick("celiac")} />
          )
        ) : view === "map" ? (
          <DirectoryMap entries={mapEntries} selectedId={selectedId} onSelect={setSelectedId} />
        ) : (
          <DirectoryList cards={visibleVms} />
        )}

        <AddSpotFab />
      </div>
    </div>
  );
}

/**
 * The server-driven sort + pagination controls, hosted inside the Filters sheet.
 *
 * The redesign's chips/search are CLIENT-side over the loaded page; these are the
 * SERVER capabilities the bundle doesn't surface visibly but which must stay
 * reachable and URL-driven (`?sort=`, `?page=`). Keeping them here preserves the
 * shareable/back-forward-correct behaviour without cluttering the mobile header.
 */
function DirectoryServerControls({
  sort,
  onSortChange,
  prompting,
  geoError,
  data,
  attrsParam,
  coords,
}: {
  sort: BrowseSort;
  onSortChange: (next: BrowseSort) => void;
  prompting: boolean;
  geoError: string | null;
  data: BrowseListingsPage;
  attrsParam: string;
  coords: UserCoords | undefined;
}) {
  const hasPrev = data.page > 1;
  const hasNext = data.hasMore;
  const lat = data.sort === "distance" ? coords?.lat : undefined;
  const lng = data.sort === "distance" ? coords?.lng : undefined;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="browse-sort" className="text-body-sm font-medium text-foreground">
          Sort by
        </label>
        <select
          id="browse-sort"
          value={sort}
          onChange={(event) => onSortChange(event.target.value as BrowseSort)}
          className="rounded-card border border-border bg-surface px-3 py-2 text-body-sm font-medium text-foreground focus-visible:border-brand-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          {BROWSE_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <output className="text-body-sm text-muted-foreground">
          {prompting ? "Finding your location…" : null}
        </output>
      </div>

      {geoError ? (
        <p
          role="alert"
          className="rounded-card border border-stale bg-stale-soft px-3 py-2 text-body-sm text-foreground"
        >
          {geoError}
        </p>
      ) : null}

      {hasPrev || hasNext ? (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between gap-3 text-body-sm"
        >
          {hasPrev ? (
            <Link
              to="/listings"
              search={{ page: data.page - 1, attrs: attrsParam, sort: data.sort, lat, lng }}
              className="font-semibold text-brand hover:text-brand-strong"
            >
              ← Previous
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
          <span className="text-muted-foreground">Page {data.page}</span>
          {hasNext ? (
            <Link
              to="/listings"
              search={{ page: data.page + 1, attrs: attrsParam, sort: data.sort, lat, lng }}
              className="font-semibold text-brand hover:text-brand-strong"
            >
              Next →
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
        </nav>
      ) : null}
    </div>
  );
}
