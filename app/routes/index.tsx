import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
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
  applyQuickToggle,
  parseQuick,
  type QuickFilterValue,
  serializeQuick,
} from "~/listings/quick";
import { type BrowseSort, DEFAULT_BROWSE_SORT } from "~/listings/sort";
import type { ClaimAttribute } from "~/listings/taxonomy";
import { useGeolocation } from "~/listings/use-geolocation";
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
 * QUICK CHIPS — SERVER-SIDE, FACETED (AUB-135/AUB-140). The "quick" chips are a
 * URL-driven set (`?quick=`, comma-separated) applied as server-side constraints on
 * the DISPLAYED safety glance, so the count + pagination stay honest and the applied
 * chips persist across refresh/share (NOT a client-side refinement of the loaded
 * page). They are grouped: `safety` (celiac-safe / gluten-friendly) is mutually
 * exclusive, `recency` (recently-verified) is an additive toggle, and selections
 * AND-compose. The search-as-chip leads the filter row (name + address, mirrored to
 * `?q=` with a debounce). The taxonomy filter (`?attrs=`) and the sort (`?sort=`)
 * render as chips directly in the same row (AUB-198 — the "Filter listings" sheet is
 * retired), and the honest pager renders at the end of the List view (AUB-200).
 *
 * ROOM FOR RESULTS (feedback batch). The shell is FULL-WIDTH (no max-width caps,
 * #1); the app-shell nav is always visible and the directory's filter bar offsets
 * below it (#2); the second community icon + city dropdown are gone (#3/#4); the
 * community banner is gone (#6); and a distance-radius filter (`?radius=`, #7)
 * replaces the old count line — anchored to the visitor's coords or Denver Union
 * Station, applied server-side to BOTH the page and the honest total.
 *
 * LIST/MAP VIEW — URL STATE, CLIENT-ONLY (owner override of AUB-164). Unlike the
 * server-affecting params above, `?view=` ("list" | "map") changes no query —
 * it's excluded from `loaderDeps` on purpose, so toggling it never refetches or
 * resets `page`. It's still a validated search param (not local `useState`)
 * because the Hard Rule treats a selected tab/view as shareable/restorable UI
 * state: refresh, back/forward, and a pasted `?view=map` link all restore it.
 * The map itself is still a placeholder (`DirectoryMap.tsx`) pending AUB-111.
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
      // The saved filter (F11) changes the result SET (and makes the response
      // viewer-specific), so it's part of a page's identity — keying on it keeps
      // the saved and unsaved views cached independently (spec §11.1).
      saved,
      // The quick-filter SET changes the result SET + honest total, so it is part of
      // a page's identity — a `?quick=` view caches independently. An empty set (no
      // chips) shares one cache entry. React Query hashes the array structurally.
      quick,
      // Whether curator-bot suggestions participate in filter matching (AUB-31,
      // `?bot=`). It changes the result SET + honest total, so it is part of a
      // page's identity.
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
          // Distance-radius FILTER (user feedback #7): keep only listings within
          // `radius` mi of the origin. Independent of userLat/userLng (the sort).
          radiusMiles: radius,
          originLat: origin.lat,
          originLng: origin.lng,
          // Server-side "Saved" filter (F11): when set, the server constrains to
          // the viewer's favorites BEFORE paginating (honest total/hasMore).
          savedOnly: saved,
          // Prebuilt quick filters (AUB-135/AUB-140): a faceted set of server-side
          // constraints on the displayed safety glance. Empty set → no quick constraint.
          quick,
          // Curator-bot suggestion participation (AUB-31, `?bot=`): default ON;
          // false reverts filters to community-evidence-only matching.
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
  // Keep the URL clean: drop any param whose value equals its default so the bar
  // never carries redundant `?page=1&sort=alpha&radius=25` noise at rest. The
  // schema still re-fills those defaults on the way in (validateSearch), so a
  // stripped URL and a shared link both hydrate to the same state. Defaults are
  // single-sourced in `BROWSE_SEARCH_DEFAULTS` so the strip map can't drift from
  // the schema (asserted in browse-search.test.ts).
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
  // The active quick-filter SET is DERIVED straight from the URL (`?quick=`), not
  // held in local state — so refresh / back-forward / a shared link all restore it
  // by construction, with no server-vs-client seeding divergence. `parseQuick`
  // validates, de-dupes, and collapses the mutually-exclusive safety group.
  const quick = parseQuick(quickParam);
  // Radius-filter ORIGIN (user feedback #7): the visitor's own coords when we have
  // them (they opted into near-me and we kept the pair in the URL), else Denver
  // Union Station — the stable downtown anchor so an anonymous, non-located
  // visitor still gets a meaningful "within N mi" filter rather than everything.
  const origin: UserCoords = coords ?? UNION_STATION;
  const { data } = useSuspenseQuery(
    browseQueryOptions(page, attrs, sort, coords, qParam, radius, origin, saved, quick, bot)
  );
  const geo = useGeolocation();

  // Post-hydration marker for the BROWSE ROUTE'S Suspense boundary (companion
  // to the root `data-hydrated` stamp in __root.tsx, and the fix behind the
  // browse sort/radius `<select>` E2E failures). The router wraps this route's
  // match in a Suspense boundary, and React hydrates a server-rendered boundary
  // in its OWN, lower-priority commit AFTER the shell commit that stamps
  // `data-hydrated` — so there is a window where the root marker is set and the
  // directory chrome is VISIBLE (it's all in the SSR HTML) but none of it is
  // hydrated yet. A discrete event fired into that dehydrated subtree makes
  // React hydrate the boundary synchronously MID-EVENT, and hydration re-syncs
  // every controlled `<select>` from its rendered prop — so a programmatic
  // `input`→`change` pair (Playwright's `selectOption`) has its chosen value
  // clobbered back to the prop before `onChange` can read it, and the sort/
  // radius never reaches the URL. Clicks survive (React re-dispatches them
  // after hydrating and a click carries no DOM value to clobber), which is why
  // only the `<select>` specs failed. This effect runs only after THIS
  // boundary's hydration commits, so it is the honest "the directory controls
  // are live" signal `waitForBrowseReady` (tests/e2e/helpers.ts) waits on.
  // Idempotent under StrictMode; never removed (same rationale as the root
  // marker — a full reload re-stamps it after re-hydration).
  useEffect(() => {
    document.documentElement.dataset.browseHydrated = "true";
  }, []);

  // The list/map view toggle is SHAREABLE/restorable UI state (Hard Rule), so it
  // is derived straight from the URL (`?view=`, validated by `browseSearchSchema`)
  // rather than local `useState` — refresh/back-forward/a shared link all restore
  // it by construction. `setView` below writes it via `navigate`.
  //
  // OWNER OVERRIDE of AUB-164: the map view is still a CSS placeholder with no
  // real map provider wired up (see `DirectoryMap.tsx`) — a real provider remains
  // deferred to AUB-111 — but the repo owner has explicitly asked for the Map
  // segment to come back on the public directory ahead of that, accepting the
  // placeholder for now. `ViewToggle` below is rendered with `mapEnabled`, so
  // `view === "map"` is reachable again. AUB-111 swaps in a real map behind the
  // same `DirectoryMap` component; do NOT delete the `view === "map"` branch,
  // `ViewToggle`'s Map segment, or `DirectoryMap` itself.
  //
  // The map's selected pin stays genuinely ephemeral local state (not shareable
  // — it's a transient in-view selection, like the URL-state doc's own example).
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * Write the List/Map choice to `?view=`. CLIENT-ONLY: `view` is intentionally
   * absent from `loaderDeps`, so this never refetches the loader or touches
   * `page` — it only swaps which content block renders below. Sits in the
   * top-of-page sticky filter bar (alongside `DistanceSelector`), so — like that
   * row's other controls — there's no below-the-fold scroll-jump to guard
   * against (contrast the listing detail page's `?tab=`, which does need
   * `resetScroll: false`).
   */
  function setView(next: DirectoryView) {
    navigate({ search: (prev) => ({ ...prev, view: next }) });
  }

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
      // Functional updater: carry every other param forward (including `saved`
      // and `quick`) and only touch what changes (`q`, and reset to page 1 — a
      // page index is meaningless under a new result set). stripSearchParams
      // drops `q` from the URL when it's "".
      navigate({ search: (prev) => ({ ...prev, page: 1, q: next }) });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, qParam, navigate]);

  // The server page as VMs (mapped once, via the shared `listingToCardVM`). Search
  // AND the quick chip are both applied SERVER-side now, so `data.cards` is already
  // the exact set to show — no client-side refinement. The public save-count (F10)
  // is threaded straight through as the trailing VM arg.
  const vms = useMemo(
    () =>
      data.cards.map((card) =>
        listingToCardVM(card.listing, card.glance, card.distanceLabel, card.favoriteCount)
      ),
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

  // Toggle a quick chip, honoring the faceted group rules (`applyQuickToggle`):
  // picking a `safety` chip replaces its sibling; `recent` toggles additively. The
  // resulting set is serialized to `?quick=` (canonical order), which drives the
  // server-side filter via the loader — resetting to page 1 (the result set changes)
  // and preserving every other param. An empty set serializes to "" (stripped from
  // the URL). Deriving `quick` from the URL means this needs no local state; the
  // loader refetch + Suspense handle the pending view, like every other server param.
  function toggleQuick(value: QuickFilterValue) {
    const next = applyQuickToggle(quick, value);
    navigate({ search: (prev) => ({ ...prev, page: 1, quick: serializeQuick(next) }) });
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

  /**
   * Toggle the server-side "Saved" filter (F11), resetting to page 1 (a page
   * index is meaningless under the favorites subset) and preserving every other
   * param (the functional updater carries `quick`, sort, coords, etc. forward).
   * Signed-in only — the auth gate lives in {@link FilterChips} (anonymous click
   * opens a sign-in dialog and never reaches here, so no `savedOnly` request is
   * ever made for an anonymous viewer).
   */
  function toggleSaved() {
    navigate({ search: (prev) => ({ ...prev, page: 1, saved: !saved }) });
  }

  /**
   * Toggle whether curator-bot suggestions participate in filter matching
   * (AUB-31, `?bot=`). Default ON (a live suggestion also satisfies the
   * taxonomy/quick-celiac filters); the "Hide bot suggestions" chip flips it to
   * community-evidence-only matching. Resets to page 1 (the result SET changes)
   * and preserves every other param. `stripSearchParams` drops the inclusive
   * default from the URL at rest.
   */
  function toggleBot() {
    navigate({ search: (prev) => ({ ...prev, page: 1, bot: !bot }) });
  }

  // The no-results CTA clears EVERY filter — the quick chips, the server-side
  // search + taxonomy filter, AND the bot-suggestions exclusion (resets to page 1
  // with no `?q=`/`?attrs=`/`?quick=`/`?bot=`).
  // The saved filter is a distinct MODE (not a "filter" over the directory), so
  // the functional updater preserves it — clearing filters inside the saved view
  // keeps you in it.
  function clearAll() {
    setSearchInput("");
    lastPushedQ.current = "";
    navigate({ search: (prev) => ({ ...prev, page: 1, attrs: "", q: "", quick: "", bot: true }) });
  }

  /**
   * Reset EVERY browse search param to its default in one navigation (repo-owner
   * mobile feedback): unlike `clearAll` above (which preserves `saved`/`sort`/
   * `radius` — it's scoped to "filters" only), this backs all the way out —
   * search, quick chips, taxonomy attrs, saved mode, sort, radius, page, and any
   * near-me coordinate pair. `search: () => ({})` is a deliberate FULL REPLACE
   * (not the usual functional updater that carries `prev` forward) — every param
   * goes away, `validateSearch` refills `BROWSE_SEARCH_DEFAULTS`, and
   * `stripSearchParams` keeps the URL bare, exactly like a fresh `/` visit.
   * `geo.reset()` mirrors `changeSort`'s non-distance branch so a stale "near me"
   * prompt/error state doesn't linger once the sort is back to alphabetical.
   */
  function resetAll() {
    setSearchInput("");
    lastPushedQ.current = "";
    geo.reset();
    navigate({ search: () => ({}) });
  }

  // Whether any filter is active — decides empty vs no-results. Uses the URL `?q=`
  // (the server-applied search), not the in-flight local input.
  const anyFilterActive = qParam.trim() !== "" || quick.length > 0 || attrs.length > 0 || !bot;

  // Whether ANY browse search param is off its default — gates the "Reset" chip
  // (repo-owner mobile feedback). Broader than `anyFilterActive` above (which only
  // covers the "no results" empty-state question): this also covers the saved
  // mode, sort, radius, page, and a near-me coordinate pair, none of which affect
  // whether results are showing. Delegates to the shared, unit-tested
  // `isAnyBrowseFilterActive` (browse-search.ts) so this can never drift from what
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
          {/* Geolocation feedback for the "Near me" sort (formerly inside the
              retired Filters sheet). The `<output>` status region is ALWAYS
              MOUNTED with only its text swapped — a live region inserted together
              with its content is commonly NOT announced by screen readers
              (matches the pre-refactor DirectoryServerControls pattern). While
              empty it drops to `sr-only` (absolutely positioned, still rendered
              and in the accessibility tree — never `display:none`, which silences
              live regions) so the idle bar gains no visible flex-gap row. The
              denial message stays a separate, conditionally-rendered
              `role="alert"` — alerts announce on insertion by design. */}
          <output className="text-body-sm text-muted-foreground empty:sr-only">
            {geo.status === "prompting" ? "Finding your location…" : null}
          </output>
          {geo.error ? (
            // Text is `text-stale` ON `bg-stale-soft` — the exact pairing the
            // SafetySignal `soft` variant uses. The `-soft` fills deliberately
            // stay LIGHT in dark mode (styling.md) while `text-foreground`
            // flips near-white, so the previous foreground pairing was
            // unreadable on dark (Vercel feedback, iPhone/dark). `--color-stale`
            // is not overridden in `.dark` (dark slate, L0.45), giving ~6:1 on
            // the L0.90–0.95 soft fill in BOTH themes — WCAG AA.
            <p
              role="alert"
              className="rounded-card border border-stale bg-stale-soft px-3 py-2 text-body-sm font-medium text-stale"
            >
              {geo.error}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            {/* The distance-radius filter takes the count's old slot (user
                feedback #7): a neutral geo control (pin + border), NOT a safety
                signal. `data.total` stays honest server-side (the radius WHERE
                constrains the count too), so removing the count text loses no
                truthfulness — the filtered results themselves are the answer. */}
            <DistanceSelector value={radius} onChange={changeRadius} />
            {/* OWNER OVERRIDE of AUB-164: `mapEnabled` passed explicitly so the Map
                segment is back on the public directory ahead of AUB-111's real map
                provider (the placeholder is accepted for now). See the comment on
                `view`/`setView` above. */}
            <ViewToggle view={view} onChange={setView} mapEnabled />
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
            <DirectoryEmpty onBrowseCeliac={() => toggleQuick("celiac")} />
          )
        ) : view === "map" ? (
          // OWNER OVERRIDE of AUB-164: reachable again on the public directory —
          // `ViewToggle`'s Map segment is enabled (see the comment on `view`/
          // `setView` above), so `view` can be "map" via `?view=map`. Still a CSS
          // placeholder (`DirectoryMap.tsx`); a real map provider remains
          // deferred to AUB-111.
          //
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
          <>
            <DirectoryList cards={vms} />
            {/* Visible pagination (AUB-200) at the end of the results: honest
                "Page N of M" from the server's total, URL-driven `?page=` links.
                LIST VIEW ONLY — the map renders the same server page as pins with
                its own carousel over a viewport-filling canvas, where a pager band
                would sit off-screen (see DirectoryPager). */}
            <DirectoryPager page={data.page} pageSize={data.pageSize} total={data.total} />
          </>
        )}
      </div>

      {/* Floating "Add listing" FAB — viewport-fixed (bottom-right) so it stays
          pinned at any scroll position / viewport height and never overlaps the
          cards. */}
      <AddSpotFab />
    </div>
  );
}
