import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AddSpotFab } from "~/components/directory/AddSpotFab";
import { DirectoryList } from "~/components/directory/DirectoryList";
import { DirectoryMap, type DirectoryMapEntry } from "~/components/directory/DirectoryMap";
import { DirectoryPager } from "~/components/directory/DirectoryPager";
import { DirectoryEmpty, DirectoryNoResults } from "~/components/directory/DirectoryStates";
import { DistanceSelector } from "~/components/directory/DistanceSelector";
import { FilterChips } from "~/components/directory/FilterChips";
import { type DirectoryView, ViewToggle } from "~/components/directory/ViewToggle";
import { listingToCardVM } from "~/components/listing/ListingCard";
import { canonicalLink, pageSeoMeta } from "~/lib/seo";
import {
  BROWSE_PAGE_SIZE,
  coordsFromSearch,
  parseAttrs,
  serializeAttrs,
  type UserCoords,
} from "~/listings/browse-params";
import {
  BROWSE_SEARCH_DEFAULTS,
  browseSearchSchema,
  isAnyBrowseFilterActive,
} from "~/listings/browse-search";
import { UNION_STATION } from "~/listings/distance";
import {
  forgetsNearMe,
  readNearMePreference,
  writeNearMePreference,
} from "~/listings/near-me-preference";
import {
  applyQuickToggle,
  parseQuick,
  type QuickFilterValue,
  serializeQuick,
} from "~/listings/quick";
import { type BrowseSort, DEFAULT_BROWSE_SORT } from "~/listings/sort";
import type { ClaimAttribute } from "~/listings/taxonomy";
import { geolocationPermission, useGeolocation } from "~/listings/use-geolocation";
import { fetchBrowseListings } from "~/server/listings/browse.fn";
import { fetchBrowsePhotos } from "~/server/places-photos.fn";

/**
 * The Denver restaurant directory — the home page (`/`) and the default
 * discovery screen (domain.md → Discovery, "list-first"). Open to anonymous
 * visitors; `/listings` redirects here.
 *
 * Data pattern: every filter that changes the result set lives in the URL, so
 * the server-filtered, SSR-prefetched view stays linkable/shareable and
 * back/forward works. Data is prefetched in the loader and read via
 * `useSuspenseQuery`, so it dehydrates into the SSR HTML and hydrates with no
 * loading flash (docs/agents/api.md). The trust glance + taxonomy filter +
 * quick filter are all computed server-side by `fetchBrowseListings`.
 *
 * Quick chips are a URL-driven set (`?quick=`, comma-separated) applied as
 * server-side constraints on the displayed safety glance, so the count +
 * pagination stay honest and the applied chips persist across refresh/share —
 * never a client-side refinement of the loaded page. `safety` is mutually
 * exclusive, `recency` is an additive toggle, selections AND-compose. The
 * search-as-chip leads the filter row (name + address, mirrored to `?q=` with
 * a debounce); the taxonomy filter and sort render as chips in the same row;
 * the honest pager renders at the end of the List view.
 *
 * The distance-radius filter (`?radius=`) is anchored to the visitor's coords
 * or Denver Union Station and applied server-side to both the page and the
 * honest total.
 *
 * List/Map view: unlike the server-affecting params, `?view=` changes no
 * query — it is excluded from `loaderDeps` on purpose, so toggling it never
 * refetches or resets `page`. It is still a validated search param (not local
 * `useState`) because the Hard Rule treats a selected tab/view as
 * shareable/restorable UI state.
 */

function browseQueryOptions(
  page: number,
  attrs: ClaimAttribute[],
  sort: BrowseSort,
  coords: UserCoords | undefined,
  q: string,
  radius: number,
  origin: UserCoords,
  saved: boolean,
  quick: QuickFilterValue[],
  bot: boolean
) {
  // Only thread coords to the server when actually distance-sorting; without
  // them the server falls back to the alphabetical default. Coords in the key
  // keep separate-location results cached independently.
  const userLat = sort === "distance" ? coords?.lat : undefined;
  const userLng = sort === "distance" ? coords?.lng : undefined;
  // Normalize the free-text query for the cache key so `""` and whitespace share
  // one cache entry (the server treats a blank query as "no text constraint").
  const trimmedQ = q.trim();
  return queryOptions({
    // The radius filter + its origin change the result set + honest total, so
    // both are part of a page's identity — a shared link and a live-located
    // visitor cache their radius views independently.
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
          // Distance-radius filter: keep only listings within `radius` mi of
          // the origin. Independent of userLat/userLng (the sort).
          radiusMiles: radius,
          originLat: origin.lat,
          originLng: origin.lng,
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
        },
      }),
  });
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: pageSeoMeta({
      title: "Browse gluten-free restaurants in Denver · Aubrey's List",
      description:
        "Browse gluten-free and celiac-safe restaurants in Denver, vetted and kept current by diners who share the need.",
      path: "/",
    }),
    links: [canonicalLink("/")],
  }),
  validateSearch: browseSearchSchema,
  // Keep the URL clean: drop any param whose value equals its default. The
  // schema re-fills those defaults on the way in (validateSearch), so a
  // stripped URL and a shared link hydrate to the same state. Defaults are
  // single-sourced in `BROWSE_SEARCH_DEFAULTS` so the strip map can't drift
  // from the schema (asserted in browse-search.test.ts).
  search: {
    middlewares: [stripSearchParams(BROWSE_SEARCH_DEFAULTS)],
  },
  loaderDeps: ({ search: { page, attrs, sort, lat, lng, q, radius, saved, quick, bot } }) => ({
    page,
    attrs,
    sort,
    lat,
    lng,
    q,
    radius,
    saved,
    quick,
    bot,
  }),
  loader: async ({
    context,
    deps: { page, attrs, sort, lat, lng, q, radius, saved, quick, bot },
  }) => {
    // SSR has no live geolocation, so the radius origin is Denver Union
    // Station. The client re-anchors to the visitor's real coords once
    // granted, which refetches under a new query key.
    await context.queryClient.ensureQueryData(
      browseQueryOptions(
        page,
        parseAttrs(attrs),
        sort,
        coordsFromSearch(lat, lng),
        q,
        radius,
        UNION_STATION,
        saved,
        parseQuick(quick),
        bot
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
    saved,
    quick: quickParam,
    bot,
    view,
  } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const attrs = parseAttrs(attrsParam);
  const coords = coordsFromSearch(lat, lng);
  // The active quick-filter set is derived straight from the URL, not held in
  // local state — refresh / back-forward / a shared link all restore it by
  // construction. `parseQuick` validates, de-dupes, and collapses the
  // mutually-exclusive safety group.
  const quick = parseQuick(quickParam);
  // Radius-filter origin: the visitor's own coords when the URL carries the
  // pair, else Denver Union Station — a stable anchor so a non-located
  // visitor still gets a meaningful "within N mi" filter.
  const origin: UserCoords = coords ?? UNION_STATION;
  const { data } = useSuspenseQuery(
    browseQueryOptions(page, attrs, sort, coords, qParam, radius, origin, saved, quick, bot)
  );
  const geo = useGeolocation();

  // Restore this device's "Near me" opt-in on load. Gated on an existing
  // grant: a stored preference never opens a permission prompt, so a visitor
  // who blocked or never granted location just gets the default order. Runs
  // once per mount, and only from the default sort with no coords in the URL,
  // so a link carrying a non-default `?sort=` or coords always wins. The first paint is
  // the SSR'd alphabetical order; the distance sort lands right after, via a
  // `replace` so Back leaves the page instead of undoing the restore.
  const nearMeRestored = useRef(false);
  useEffect(() => {
    if (nearMeRestored.current) return;
    nearMeRestored.current = true;
    if (sort !== DEFAULT_BROWSE_SORT || coords || !readNearMePreference()) return;
    void geolocationPermission().then((state) => {
      if (state !== "granted") return;
      void geo.request().then((result) => {
        if (result.status !== "success") {
          if (forgetsNearMe(result.reason)) writeNearMePreference(false);
          return;
        }
        navigate({
          replace: true,
          search: (prev) => ({
            ...prev,
            page: 1,
            sort: "distance",
            lat: result.coords.lat,
            lng: result.coords.lng,
          }),
        });
      });
    });
  }, [sort, coords, geo, navigate]);

  // Post-hydration marker for this route's Suspense boundary (companion to
  // the root `data-hydrated` stamp). React hydrates a server-rendered
  // boundary in its own, lower-priority commit after the shell commit that
  // stamps `data-hydrated`, so there is a window where the root marker is set
  // but the visible directory chrome is not hydrated. A discrete event fired
  // into that dehydrated subtree makes React hydrate the boundary mid-event,
  // and hydration re-syncs every controlled `<select>` from its rendered prop
  // — so a programmatic `input`→`change` pair (Playwright's `selectOption`)
  // has its chosen value clobbered before `onChange` can read it. Clicks
  // survive (React re-dispatches them, and a click carries no DOM value to
  // clobber). This effect runs only after this boundary's hydration commits,
  // so it is the honest "directory controls are live" signal
  // `waitForBrowseReady` (tests/e2e/helpers.ts) waits on. Idempotent under
  // StrictMode; never removed — a full reload re-stamps it.
  useEffect(() => {
    document.documentElement.dataset.browseHydrated = "true";
  }, []);

  // The list/map view toggle is shareable/restorable UI state (Hard Rule), so
  // it is derived straight from the URL (`?view=`, validated by
  // `browseSearchSchema`) rather than local `useState`. `setView` below
  // writes it via `navigate`.
  //
  // The Map segment is deliberately enabled on the public directory (owner
  // decision): `ViewToggle` renders with `mapEnabled` and `view === "map"` is
  // reachable. The map view is a real Google map when the public
  // `VITE_GOOGLE_MAPS_BROWSER_KEY` is provisioned, and the stylized CSS
  // placeholder otherwise (`DirectoryMap.tsx`). Do not delete the
  // `view === "map"` branch, `ViewToggle`'s Map segment, or `DirectoryMap`.
  //
  // The map's selected pin stays genuinely ephemeral local state — a
  // transient in-view selection, not shareable.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * Write the List/Map choice to `?view=`. Client-only: `view` is absent from
   * `loaderDeps`, so this never refetches the loader or touches `page` — it
   * only swaps which content block renders. The control sits in the sticky
   * top-of-page filter bar, so there is no below-the-fold scroll-jump to
   * guard against (contrast the detail page's `?tab=`, which needs
   * `resetScroll: false`).
   */
  function setView(next: DirectoryView) {
    navigate({ search: (prev) => ({ ...prev, view: next }) });
  }

  // The search box is a controlled local input mirrored to the URL `?q=` with
  // a debounce, so typing stays smooth while the server search covers every
  // listing (not just the loaded page). It seeds from the URL so a shared
  // search hydrates correctly, and reconciles if the URL changes underneath.
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

  // Debounce the input → URL navigation. A blank/whitespace query normalizes
  // to "" so it round-trips as "no text constraint". Searching resets to page
  // 1 (a page index is meaningless under a new result set) and preserves the
  // active taxonomy filter, sort, and coords.
  useEffect(() => {
    const next = searchInput.trim();
    if (next === qParam.trim()) {
      return;
    }
    const timer = setTimeout(() => {
      lastPushedQ.current = next;
      // Functional updater: carry every other param forward and only touch
      // what changes. stripSearchParams drops `q` from the URL when it's "".
      navigate({ search: (prev) => ({ ...prev, page: 1, q: next }) });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, qParam, navigate]);

  // Render-time Google Place photos for the current page's cards.
  // Deliberately outside the critical loader path — never `ensureQueryData`d,
  // so SSR never waits on the Places Photos call: cards paint with their
  // gradient placeholder first, and photos swap in client-side with no layout
  // shift (the photo tile reserves a fixed height). Keyed on the page's
  // listing ids, so paging/filtering to a new set fetches and caches that
  // set's photos. Server-side, the batch fn is bounded and cached
  // (`~/server/places-photos`), so this costs at most one photos-only call
  // per new place per 12h window.
  // Sorted for the query key: the photo set depends only on which ids are on
  // the page, not their order, so re-sorting the directory must hit the same
  // cache entry instead of refiring the batch. Sorting the payload too keeps
  // key and request in sync (the server dedupes; order is irrelevant to it).
  const listingIds = useMemo(() => data.cards.map((card) => card.listing.id).sort(), [data.cards]);
  const { data: photosById } = useQuery({
    queryKey: ["browse-photos", listingIds],
    queryFn: () => fetchBrowsePhotos({ data: { listingIds } }),
    enabled: listingIds.length > 0,
    // Server-side metadata is cached ~12h per place; within a session there
    // is nothing to refetch for decorative images.
    staleTime: Infinity,
    retry: 1,
  });

  // The server page as VMs, mapped once via the shared `listingToCardVM`.
  // Search and the quick chips are applied server-side, so `data.cards` is
  // already the exact set to show — no client-side refinement. The public
  // save-count threads through as the trailing VM arg, followed by this
  // listing's photo when the batch query has resolved one — otherwise
  // `photoUrl` stays unset and the card renders its gradient tile.
  const vms = useMemo(
    () =>
      data.cards.map((card) =>
        listingToCardVM(
          card.listing,
          card.glance,
          card.distanceLabel,
          card.favoriteCount,
          photosById?.[card.listing.id]
        )
      ),
    [data.cards, photosById]
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

  // Toggle a quick chip, honoring the faceted group rules: a `safety` chip
  // replaces its sibling; `recent` toggles additively. The set serializes to
  // `?quick=` (canonical order), driving the server-side filter via the
  // loader — reset to page 1, every other param preserved. An empty set
  // serializes to "" and is stripped from the URL.
  function toggleQuick(value: QuickFilterValue) {
    const next = applyQuickToggle(quick, value);
    navigate({ search: (prev) => ({ ...prev, page: 1, quick: serializeQuick(next) }) });
  }

  // Toggling a taxonomy attribute resets to page 1 and preserves the search
  // query, sort, and coords.
  function toggleAttribute(attribute: ClaimAttribute) {
    const next = attrs.includes(attribute)
      ? attrs.filter((a) => a !== attribute)
      : [...attrs, attribute];
    navigate({ search: (prev) => ({ ...prev, page: 1, attrs: serializeAttrs(next) }) });
  }

  /**
   * Change the server-side sort, resetting to page 1. "Near me" is special:
   * it requests geolocation only on opt-in and falls back to the default
   * order on denial/unavailable — never a surprise prompt, never a crash. A
   * granted opt-in is remembered per device (`near-me-preference`) and picked
   * back up by the restore effect above; any other sort forgets it.
   */
  function changeSort(next: BrowseSort) {
    if (next !== "distance") {
      geo.reset();
      writeNearMePreference(false);
      navigate({
        search: (prev) => ({ ...prev, page: 1, sort: next, lat: undefined, lng: undefined }),
      });
      return;
    }
    void geo.request().then((result) => {
      if (result.status === "success") {
        writeNearMePreference(true);
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
        if (forgetsNearMe(result.reason)) writeNearMePreference(false);
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
   * Change the distance-radius filter. Resets to page 1 and preserves every
   * other param. The origin isn't in the URL — it's re-derived on render from
   * the visitor's coords (or Union Station), so only the radius travels here.
   */
  function changeRadius(nextRadius: number) {
    navigate({ search: (prev) => ({ ...prev, page: 1, radius: nextRadius }) });
  }

  /**
   * Toggle the server-side "Saved" filter, resetting to page 1 and preserving
   * every other param. Signed-in only — the auth gate lives in
   * {@link FilterChips}: an anonymous click opens a sign-in dialog and never
   * reaches here, so no `savedOnly` request is made for an anonymous viewer.
   */
  function toggleSaved() {
    navigate({ search: (prev) => ({ ...prev, page: 1, saved: !saved }) });
  }

  /**
   * Toggle whether curator-bot suggestions participate in the browse
   * (`?bot=`). The inclusive default lets a live suggestion satisfy the
   * taxonomy/quick-celiac filters and shows bot-suggested-only listings; the
   * "Hide bot suggestions" chip flips to community-evidence-only matching and
   * hides bot-suggested-only listings, server-side, so the page and honest
   * total both reflect it. Resets to page 1 and preserves every other param.
   */
  function toggleBot() {
    navigate({ search: (prev) => ({ ...prev, page: 1, bot: !bot }) });
  }

  // The no-results CTA clears every filter — quick chips, search, taxonomy
  // filter, and the bot-suggestions exclusion. The saved filter is a distinct
  // mode, not a filter over the directory, so the functional updater
  // preserves it — clearing filters inside the saved view keeps you in it.
  function clearAll() {
    setSearchInput("");
    lastPushedQ.current = "";
    navigate({ search: (prev) => ({ ...prev, page: 1, attrs: "", q: "", quick: "", bot: true }) });
  }

  /**
   * Reset every browse search param to its default in one navigation. Unlike
   * `clearAll` (scoped to "filters" only), this backs all the way out —
   * search, quick chips, taxonomy attrs, saved mode, sort, radius, page, any
   * near-me coordinate pair, and the client-only List/Map `?view=`.
   * `search: () => ({})` is a deliberate full replace: every param goes away,
   * `validateSearch` refills `BROWSE_SEARCH_DEFAULTS`, and `stripSearchParams`
   * keeps the URL bare — exactly like a fresh `/` visit. That fresh-visit
   * semantic is why `view` resets too, even though `view` alone never lights
   * the Reset chip (see the note in browse-search.ts). `geo.reset()` plus
   * clearing the remembered "Near me" opt-in mirrors `changeSort`'s
   * non-distance branch, so neither a stale prompt/error state nor a restored
   * distance sort survives the reset.
   */
  function resetAll() {
    setSearchInput("");
    lastPushedQ.current = "";
    geo.reset();
    writeNearMePreference(false);
    navigate({ search: () => ({}) });
  }

  // Whether any filter is active — decides empty vs no-results. Uses the URL
  // `?q=` (the server-applied search), not the in-flight local input.
  const anyFilterActive = qParam.trim() !== "" || quick.length > 0 || attrs.length > 0 || !bot;

  // Whether any browse search param is off its default — gates the "Reset"
  // chip. Broader than `anyFilterActive` above: this also covers the saved
  // mode, sort, radius, page, and a near-me coordinate pair, none of which
  // affect whether results are showing. Delegates to the shared
  // `isAnyBrowseFilterActive` so this can never drift from what
  // `stripSearchParams` considers "at rest".
  const isAnyFilterActive = isAnyBrowseFilterActive({
    page,
    attrs: attrsParam,
    q: qParam,
    sort,
    radius,
    quick: quickParam,
    saved,
    bot,
    lat,
    lng,
  });

  // Distance is a neutral geo convenience — never a safety signal — so the
  // selector uses plain chip styling and shows only "Within X miles".

  return (
    // A generous but bounded, centered max-width — edge-to-edge full-bleed
    // looks broken on large screens. The grid inside DirectoryList adds
    // columns on wide screens to fill it.
    <div className="mx-auto w-full max-w-[96rem]">
      {/* The directory's sticky filter bar: search + chips + distance/view
          row. It offsets below the always-visible app-shell nav
          (`top-[var(--site-header-h)]`) so the two never overlap or gap, and
          sits at `z-20` — under the nav (`z-40`) and Radix overlays (`z-50`).
          It sticks as the page scrolls naturally, so the filters stay
          reachable without trapping height on a short viewport. */}
      <div className="sticky top-[var(--site-header-h)] z-20 border-b border-border bg-background">
        <div className="flex flex-col gap-3 px-gutter pb-3 pt-3">
          <FilterChips
            attrs={attrs}
            onToggleAttr={toggleAttribute}
            quick={quick}
            onQuickToggle={toggleQuick}
            search={searchInput}
            onSearchChange={setSearchInput}
            saved={saved}
            onSavedToggle={toggleSaved}
            bot={bot}
            onBotToggle={toggleBot}
            sort={sort}
            onSortChange={changeSort}
            isAnyFilterActive={isAnyFilterActive}
            onResetAll={resetAll}
          />
          {/* Geolocation feedback for the "Near me" sort. The `<output>`
              status region is always mounted with only its text swapped — a
              live region inserted together with its content is commonly not
              announced by screen readers. While empty it drops to `sr-only`
              (still rendered and in the accessibility tree — never
              `display:none`, which silences live regions) so the idle bar
              gains no visible flex-gap row. The denial message stays a
              separate, conditionally-rendered `role="alert"` — alerts
              announce on insertion by design. */}
          <output className="text-body-sm text-muted-foreground empty:sr-only">
            {geo.status === "prompting" ? "Finding your location…" : null}
          </output>
          {geo.error ? (
            // Text is `text-stale` on `bg-stale-soft` — the exact pairing the
            // SafetySignal `soft` variant uses. The `-soft` fills stay light
            // in dark mode (styling.md) while `text-foreground` flips
            // near-white, so a foreground pairing is unreadable on dark.
            // `--color-stale` is not overridden in `.dark`, giving ~6:1 on
            // the soft fill in both themes — WCAG AA.
            <p
              role="alert"
              className="rounded-card border border-stale bg-stale-soft px-3 py-2 text-body-sm font-medium text-stale"
            >
              {geo.error}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            {/* The distance-radius filter: a neutral geo control (pin +
                border), not a safety signal. `data.total` stays honest
                server-side (the radius WHERE constrains the count too), so
                showing no count text loses no truthfulness — the filtered
                results themselves are the answer. */}
            <DistanceSelector value={radius} onChange={changeRadius} />
            {/* `mapEnabled` passed explicitly so the Map segment is on the
                public directory (owner decision; key-gated map with a
                CSS-placeholder fallback). See the comment on `view`/`setView`
                above. */}
            <ViewToggle view={view} onChange={setView} mapEnabled />
          </div>
        </div>
      </div>

      {/* Content area — renders exactly one state. The page scrolls (no inner
          scroll region), so this is a plain block with generous bottom
          padding so the last card clears the viewport-fixed FAB. `relative`
          anchors the map's absolutely-positioned backdrop + pins. */}
      <div className="relative bg-background px-gutter pb-28 pt-4">
        {vms.length === 0 ? (
          anyFilterActive ? (
            <DirectoryNoResults onClearAll={clearAll} />
          ) : (
            <DirectoryEmpty onBrowseCeliac={() => toggleQuick("celiac")} />
          )
        ) : view === "map" ? (
          // Reachable via `?view=map` — the Map segment is enabled on the
          // public directory (see the comment on `view`/`setView` above).
          // Renders a real Google map when the public browser key is
          // provisioned, and the stylized CSS placeholder otherwise
          // (`DirectoryMap.tsx`).
          //
          // The map is absolutely positioned (`inset-0`) inside its own root,
          // so under natural document scroll it needs a bounded, positioned
          // box to fill. A viewport-relative height with a sensible floor
          // keeps the map canvas, pins, and the opaque bottom carousel band
          // all visible — preserving the carousel-above-pins safety invariant
          // and pin/mini-card selection sync.
          <div className="relative h-[calc(100dvh-14rem)] min-h-[26rem]">
            <DirectoryMap entries={mapEntries} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        ) : (
          <>
            <DirectoryList cards={vms} />
            {/* Visible pagination at the end of the results: honest
                "Page N of M" from the server's total, URL-driven `?page=`
                links. List view only — the map renders the same server page
                as pins with its own carousel over a viewport-filling canvas,
                where a pager band would sit off-screen. */}
            <DirectoryPager page={data.page} pageSize={data.pageSize} total={data.total} />
          </>
        )}
      </div>

      {/* Floating "Add listing" FAB — viewport-fixed (bottom-right) so it
          stays pinned at any scroll position and never overlaps the cards. */}
      <AddSpotFab />
    </div>
  );
}
