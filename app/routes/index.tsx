import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AddSpotFab } from "~/components/directory/AddSpotFab";
import { DirectoryList } from "~/components/directory/DirectoryList";
import { DirectoryMap, type DirectoryMapEntry } from "~/components/directory/DirectoryMap";
import { DirectoryEmpty, DirectoryNoResults } from "~/components/directory/DirectoryStates";
import { DistanceSelector } from "~/components/directory/DistanceSelector";
import { FilterChips } from "~/components/directory/FilterChips";
import { type DirectoryView, ViewToggle } from "~/components/directory/ViewToggle";
import { listingToCardVM } from "~/components/listing/ListingCard";
import { canonicalLink, pageSeoMeta } from "~/lib/seo";
import {
  BROWSE_PAGE_SIZE,
  type UserCoords,
  coordsFromSearch,
  parseAttrs,
  serializeAttrs,
} from "~/listings/browse-params";
import { BROWSE_SEARCH_DEFAULTS, browseSearchSchema } from "~/listings/browse-search";
import { UNION_STATION } from "~/listings/distance";
import type { QuickFilter } from "~/listings/quick";
import { BROWSE_SORT_OPTIONS, type BrowseSort, DEFAULT_BROWSE_SORT } from "~/listings/sort";
import type { ClaimAttribute } from "~/listings/taxonomy";
import { useGeolocation } from "~/listings/use-geolocation";
import type { BrowseListingsPage } from "~/server/listings/browse";
import { fetchBrowseListings } from "~/server/listings/browse.fn";

/**
 * The Denver restaurant directory — the HOME PAGE (`/`) and the default discovery
 * screen (domain.md → Discovery, "list-first"), rebuilt to the AUB-61 Claude
 * Design bundle (Phase 2b). Open to anonymous visitors (reads are open). Visitors
 * land directly in the directory; the old marketing landing is retired and
 * `/listings` redirects here (AUB-116).
 *
 * DATA PATTERN — PRESERVED. Every filter that changes the result set lives in the
 * URL (`?page=`, `?attrs=`, `?sort=`, `?q=`, `?lat=`/`?lng=`, `?radius=`, and the
 * quick chip `?quick=`), so the server-filtered, SSR-prefetched view stays
 * linkable/shareable and back/forward works. Data is prefetched in the loader and
 * read via `useSuspenseQuery`, so it dehydrates into the SSR HTML and hydrates with
 * no loading flash (docs/agents/api.md). The trust glance + consensus taxonomy
 * filter + quick filter are all computed server-side by `fetchBrowseListings`.
 *
 * QUICK CHIPS — SERVER-SIDE (AUB-135). The three mutually-exclusive "quick" chips
 * (celiac-safe / gluten-friendly / recently-verified) are URL-driven (`?quick=`)
 * and applied as a server-side constraint on the DISPLAYED safety glance, so the
 * count + pagination stay honest and an applied chip persists across refresh/share
 * (they are NOT a client-side refinement of the loaded page). The search-as-chip
 * leads the filter row (name + address, mirrored to `?q=` with a debounce). The
 * taxonomy filter lives behind the "Filters" sheet and drives `?attrs=`.
 *
 * ROOM FOR RESULTS (feedback batch). The shell is FULL-WIDTH (no max-width caps,
 * #1); the app-shell nav is always visible and the directory's filter bar offsets
 * below it (#2); the second community icon + city dropdown are gone (#3/#4); the
 * community banner is gone (#6); and a distance-radius filter (`?radius=`, #7)
 * replaces the old count line — anchored to the visitor's coords or Denver Union
 * Station, applied server-side to BOTH the page and the honest total.
 */

function browseQueryOptions(
  page: number,
  attrs: ClaimAttribute[],
  sort: BrowseSort,
  coords: UserCoords | undefined,
  q: string,
  radius: number,
  origin: UserCoords,
  quick: QuickFilter
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
    // The radius filter + its origin are part of the identity of a page (they
    // change the result SET + honest total), so both are in the key — a shared
    // link and a live-located visitor cache their radius views independently.
    queryKey: [
      "browse-listings",
      page,
      attrs,
      sort,
      userLat ?? null,
      userLng ?? null,
      trimmedQ,
      radius,
      origin.lat,
      origin.lng,
      // The quick chip changes the result SET + honest total, so it is part of a
      // page's identity — a `?quick=` view caches independently. `null` (no chip)
      // shares one cache entry.
      quick,
    ],
    queryFn: () =>
      fetchBrowseListings({
        data: {
          page,
          pageSize: BROWSE_PAGE_SIZE,
          attrs,
          sort,
          userLat,
          userLng,
          q: trimmedQ,
          // Distance-radius FILTER (user feedback #7): keep only listings within
          // `radius` mi of the origin. Independent of userLat/userLng (the sort).
          radiusMiles: radius,
          originLat: origin.lat,
          originLng: origin.lng,
          // Prebuilt quick filter (AUB-135): a server-side constraint on the
          // displayed safety glance. `null` → omit, so no quick constraint.
          quick: quick ?? undefined,
        },
      }),
  });
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: pageSeoMeta({
      title: "Browse gluten-free restaurants in Denver · Aubrey's List",
      description:
        "Browse Denver's community-vetted directory of gluten-free and celiac-safe restaurants — every listing is contributed, attested, and kept fresh by people who live with the same stakes.",
      path: "/",
    }),
    links: [canonicalLink("/")],
  }),
  validateSearch: browseSearchSchema,
  // Keep the URL clean: drop any param whose value equals its default so the bar
  // never carries redundant `?page=1&sort=alpha&radius=25` noise at rest. The
  // schema still re-fills those defaults on the way in (validateSearch), so a
  // stripped URL and a shared link both hydrate to the same state. Defaults are
  // single-sourced in `BROWSE_SEARCH_DEFAULTS` so the strip map can't drift from
  // the schema (asserted in browse-search.test.ts).
  search: {
    middlewares: [stripSearchParams(BROWSE_SEARCH_DEFAULTS)],
  },
  loaderDeps: ({ search: { page, attrs, sort, lat, lng, q, radius, quick } }) => ({
    page,
    attrs,
    sort,
    lat,
    lng,
    q,
    radius,
    quick,
  }),
  loader: async ({ context, deps: { page, attrs, sort, lat, lng, q, radius, quick } }) => {
    // SSR has no live geolocation, so the radius origin is Denver Union Station
    // (user feedback #7). The client re-anchors to the visitor's real coords once
    // granted (see BrowseListings), which refetches under a new query key.
    await context.queryClient.ensureQueryData(
      browseQueryOptions(
        page,
        parseAttrs(attrs),
        sort,
        coordsFromSearch(lat, lng),
        q,
        radius,
        UNION_STATION,
        quick ?? null
      )
    );
  },
  component: BrowseListings,
});

/** Debounce before a keystroke is pushed to the URL `?q=` (keeps typing smooth). */
const SEARCH_DEBOUNCE_MS = 275;

function BrowseListings() {
  const {
    page,
    attrs: attrsParam,
    sort,
    lat,
    lng,
    q: qParam,
    radius,
    quick: quickParam,
  } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const attrs = parseAttrs(attrsParam);
  const coords = coordsFromSearch(lat, lng);
  // The active quick chip is DERIVED straight from the URL (`?quick=`), not held in
  // local state — so refresh / back-forward / a shared link all restore it by
  // construction, with no server-vs-client seeding divergence. `undefined` (no
  // param) reads as `null` (no chip).
  const quick: QuickFilter = quickParam ?? null;
  // Radius-filter ORIGIN (user feedback #7): the visitor's own coords when we have
  // them (they opted into near-me and we kept the pair in the URL), else Denver
  // Union Station — the stable downtown anchor so an anonymous, non-located
  // visitor still gets a meaningful "within N mi" filter rather than everything.
  const origin: UserCoords = coords ?? UNION_STATION;
  const { data } = useSuspenseQuery(
    browseQueryOptions(page, attrs, sort, coords, qParam, radius, origin, quick)
  );
  const geo = useGeolocation();

  // Remaining directory UI state is purely ephemeral (not shareable): the list/map
  // view toggle and the map's selected pin.
  const [view, setView] = useState<DirectoryView>("list");
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
      // Functional updater: carry every other param forward and only touch what
      // changes (`q`, and reset to page 1 — a page index is meaningless under a
      // new result set). stripSearchParams drops `q` from the URL when it's "".
      navigate({ search: (prev) => ({ ...prev, page: 1, q: next }) });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, qParam, navigate]);

  // The server page as VMs (mapped once, via the shared `listingToCardVM`). Search
  // AND the quick chip are both applied SERVER-side now, so `data.cards` is already
  // the exact set to show — no client-side refinement.
  const vms = useMemo(
    () => data.cards.map((card) => listingToCardVM(card.listing, card.glance, card.distanceLabel)),
    [data.cards]
  );

  // Map entries pair each VM with its real coordinates to project (never
  // recomputed — straight from the loaded listing).
  const mapEntries: DirectoryMapEntry[] = useMemo(() => {
    const coordsById = new Map(data.cards.map((card) => [card.listing.id, card.listing]));
    return vms.flatMap((vm) => {
      const listing = coordsById.get(vm.id);
      return listing ? [{ vm, lat: listing.lat, lng: listing.lng }] : [];
    });
  }, [vms, data.cards]);

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

  // Apply a quick chip by writing it to the URL (`?quick=`), which drives the
  // server-side filter via the loader — resetting to page 1 (the result set
  // changes) and preserving every other param. `null` (toggling the active chip
  // off) omits the param. Deriving `quick` from the URL means this needs no local
  // state; the loader refetch + Suspense handle the pending view, like every other
  // server-side param.
  function changeQuick(next: QuickFilter) {
    navigate({ search: (prev) => ({ ...prev, page: 1, quick: next ?? undefined }) });
  }

  // Toggling a taxonomy attribute (the REAL server filter) always resets to page
  // 1 and preserves the search query, sort + coords, exactly as before the
  // redesign.
  function toggleAttribute(attribute: ClaimAttribute) {
    const next = attrs.includes(attribute)
      ? attrs.filter((a) => a !== attribute)
      : [...attrs, attribute];
    navigate({ search: (prev) => ({ ...prev, page: 1, attrs: serializeAttrs(next) }) });
  }

  function clearAttributes() {
    navigate({ search: (prev) => ({ ...prev, page: 1, attrs: "" }) });
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
        search: (prev) => ({ ...prev, page: 1, sort: next, lat: undefined, lng: undefined }),
      });
      return;
    }
    void geo.request().then((result) => {
      if (result.status === "success") {
        navigate({
          search: (prev) => ({
            ...prev,
            page: 1,
            sort: "distance",
            lat: result.coords.lat,
            lng: result.coords.lng,
          }),
        });
      } else {
        navigate({
          search: (prev) => ({
            ...prev,
            page: 1,
            sort: DEFAULT_BROWSE_SORT,
            lat: undefined,
            lng: undefined,
          }),
        });
      }
    });
  }

  /**
   * Change the distance-radius filter (user feedback #7). Resets to page 1 (a
   * page index is meaningless under a narrower/wider result set) and preserves
   * every other param — the search, taxonomy filter, sort, and near-me coords.
   * The origin isn't in the URL; it's re-derived on render from the visitor's
   * coords (or Union Station), so only the radius travels here.
   */
  function changeRadius(nextRadius: number) {
    navigate({ search: (prev) => ({ ...prev, page: 1, radius: nextRadius }) });
  }

  // The no-results CTA clears EVERY filter — the quick chip AND the server-side
  // search + taxonomy filter (resets to page 1 with no `?q=`/`?attrs=`/`?quick=`).
  function clearAll() {
    setSearchInput("");
    lastPushedQ.current = "";
    navigate({ search: (prev) => ({ ...prev, page: 1, attrs: "", q: "", quick: undefined }) });
  }

  // Whether any filter is active across BOTH layers — decides empty vs no-results.
  // Uses the URL `?q=` (the server-applied search), not the in-flight local input.
  const anyFilterActive = qParam.trim() !== "" || quick !== null || attrs.length > 0;

  // The radius origin label (user feedback #7): "your location" once we have the
  // visitor's coords (near-me opt-in kept the pair in the URL), else the stable
  // "Union Station" fallback the radius is anchored to. Distance is a neutral geo
  // convenience — never a safety signal — so the selector uses plain chip styling.
  // The selector itself shows only "Within X miles" (origin not surfaced).

  return (
    // WIDTH (user feedback #1, refined per preview comment): a generous but
    // BOUNDED, centered max-width — edge-to-edge full-bleed looked busted on large
    // screens. The grid inside DirectoryList adds columns on wide screens to fill it.
    <div className="mx-auto w-full max-w-[96rem]">
      {/* The directory's own sticky filter bar: search + chips + distance/view
          row. It offsets BELOW the always-visible app-shell nav
          (`top-[var(--site-header-h)]`, user feedback #2) so the two never overlap
          or leave a gap, and sits at `z-20` — under the nav (`z-40`) and under
          Radix overlays (`z-50`). It sticks as the PAGE scrolls naturally, so the
          filters stay reachable without trapping height on a short viewport. */}
      <div className="sticky top-[var(--site-header-h)] z-20 border-b border-border bg-background">
        <div className="flex flex-col gap-3 px-gutter pb-3 pt-3">
          <FilterChips
            attrs={attrs}
            onToggleAttr={toggleAttribute}
            onClearAttrs={clearAttributes}
            quick={quick}
            onQuickChange={changeQuick}
            search={searchInput}
            onSearchChange={setSearchInput}
            sheetExtras={
              <DirectoryServerControls
                sort={sort}
                onSortChange={changeSort}
                prompting={geo.status === "prompting"}
                geoError={geo.error}
                data={data}
              />
            }
          />
          <div className="flex items-center justify-between gap-3">
            {/* The distance-radius filter takes the count's old slot (user
                feedback #7): a neutral geo control (pin + border), NOT a safety
                signal. `data.total` stays honest server-side (the radius WHERE
                constrains the count too), so removing the count text loses no
                truthfulness — the filtered results themselves are the answer. */}
            <DistanceSelector value={radius} onChange={changeRadius} />
            <ViewToggle view={view} onChange={setView} />
          </div>
        </div>
      </div>

      {/* Content area — renders exactly ONE state. The PAGE scrolls (no inner
          scroll region), so this is a plain block with generous bottom padding so
          the last card clears the viewport-fixed FAB. `relative` still anchors the
          map's absolutely-positioned backdrop + pins to its bounded wrapper. */}
      <div className="relative bg-background px-gutter pb-28 pt-4">
        {vms.length === 0 ? (
          anyFilterActive ? (
            <DirectoryNoResults onClearAll={clearAll} />
          ) : (
            <DirectoryEmpty onBrowseCeliac={() => changeQuick("celiac")} />
          )
        ) : view === "map" ? (
          // The map is absolutely positioned (`inset-0`) inside its own root, so
          // under natural document scroll it needs a BOUNDED, positioned box to
          // fill. A viewport-relative height (minus the sticky header's footprint)
          // with a sensible floor keeps the backdrop, pins, and the opaque bottom
          // carousel band all visible — preserving the carousel-above-pins safety
          // invariant and pin/mini-card selection sync unchanged.
          <div className="relative h-[calc(100dvh-14rem)] min-h-[26rem]">
            <DirectoryMap entries={mapEntries} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        ) : (
          <DirectoryList cards={vms} />
        )}
      </div>

      {/* Floating "Add listing" FAB — viewport-fixed (bottom-right) so it stays
          pinned at any scroll position / viewport height and never overlaps the
          cards. */}
      <AddSpotFab />
    </div>
  );
}

/**
 * The server-driven sort + pagination controls, hosted inside the Filters sheet.
 *
 * These are the SERVER capabilities the redesign doesn't surface as visible chips
 * but which must stay reachable and URL-driven (`?sort=`, `?page=`). Keeping them
 * here preserves the shareable/back-forward-correct behaviour without cluttering
 * the mobile header.
 */
function DirectoryServerControls({
  sort,
  onSortChange,
  prompting,
  geoError,
  data,
}: {
  sort: BrowseSort;
  onSortChange: (next: BrowseSort) => void;
  prompting: boolean;
  geoError: string | null;
  data: BrowseListingsPage;
}) {
  const hasPrev = data.page > 1;
  const hasNext = data.hasMore;

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
              to="/"
              search={(prev) => ({ ...prev, page: data.page - 1 })}
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
              to="/"
              search={(prev) => ({ ...prev, page: data.page + 1 })}
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
