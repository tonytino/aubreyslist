import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  parseAttrs,
  serializeAttrs,
  type UserCoords,
} from "~/listings/browse-params";
import {
  BROWSE_SEARCH_DEFAULTS,
  browseSearchSchema,
  isAnyBrowseFilterActive,
} from "~/listings/browse-search";
import { coarsenCoords } from "~/listings/distance";
import {
  applyQuickToggle,
  parseQuick,
  type QuickFilterValue,
  serializeQuick,
} from "~/listings/quick";
import type { BrowseSort } from "~/listings/sort";
import type { ClaimAttribute } from "~/listings/taxonomy";
import { useGeolocation } from "~/listings/use-geolocation";
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
  saved: boolean,
  quick: QuickFilterValue[],
  bot: boolean
) {
  // Only thread coords to the server when actually distance-sorting; without
  // them the server anchors on the request's coarse location or degrades to
  // the fallback order. Coords in the key cache each location independently.
  const userLat = sort === "distance" ? coords?.lat : undefined;
  const userLng = sort === "distance" ? coords?.lng : undefined;
  // Normalize the free-text query for the cache key so `""` and whitespace share
  // one cache entry (the server treats a blank query as "no text constraint").
  const trimmedQ = q.trim();
  return queryOptions({
    // The radius filter changes the result set + honest total, so it is part
    // of a page's identity. Its origin is resolved server-side from the same
    // coords already in this key.
    queryKey: [
      "browse-listings",
      page,
      attrs,
      sort,
      userLat ?? null,
      userLng ?? null,
      trimmedQ,
      radius,
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
  loaderDeps: ({ search: { page, attrs, sort, q, radius, saved, quick, bot } }) => ({
    page,
    attrs,
    sort,
    q,
    radius,
    saved,
    quick,
    bot,
  }),
  loader: async ({ context, deps: { page, attrs, sort, q, radius, saved, quick, bot } }) => {
    // SSR has no browser reading, so this prefetch carries no coords: the
    // server anchors the default "near me" sort on the request's coarse
    // location, or degrades to the fallback order. Once the browser answers,
    // the client refetches under a new query key.
    await context.queryClient.ensureQueryData(
      browseQueryOptions(
        page,
        parseAttrs(attrs),
        sort,
        undefined,
        q,
        radius,
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
    q: qParam,
    radius,
    saved,
    quick: quickParam,
    bot,
    view,
  } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const attrs = parseAttrs(attrsParam);
  // The visitor's location: route state, never a search param. It lives for
  // the life of the tab, is rounded before it is set (`coarsenCoords`), and
  // reaches the server only as a server-function argument — so it never
  // enters the URL, browser history, a referrer, or a shared link. A refresh
  // simply asks the browser again, which is silent once permission is
  // granted. The distance-sorted view stays linkable through `?sort=` alone;
  // the recipient is anchored by their own location, not the sender's.
  const [coords, setCoords] = useState<UserCoords | undefined>(undefined);
  // Rounded on the way in, and inside a transition: the new coords change the
  // query key, and `useSuspenseQuery` suspends on a key change. Without the
  // transition the whole directory would drop to its fallback for the length
  // of one fetch; with it the current results stay on screen until the
  // distance-sorted page is ready.
  const locate = useCallback((reading: UserCoords) => {
    startTransition(() => setCoords(coarsenCoords(reading)));
  }, []);
  // The active quick-filter set is derived straight from the URL, not held in
  // local state — refresh / back-forward / a shared link all restore it by
  // construction. `parseQuick` validates, de-dupes, and collapses the
  // mutually-exclusive safety group.
  const quick = parseQuick(quickParam);
  const { data } = useSuspenseQuery(
    browseQueryOptions(page, attrs, sort, coords, qParam, radius, saved, quick, bot)
  );
  const geo = useGeolocation();

  // Ask the browser for a reading. The in-flight guard is a ref rather than
  // `geo.status`, which the caller cannot observe until the next render — two
  // callers in one tick would otherwise both fire.
  const locating = useRef(false);
  const requestLocation = useCallback(() => {
    if (locating.current) return;
    locating.current = true;
    void geo.request().then((result) => {
      locating.current = false;
      if (result.status === "success") locate(result.coords);
    });
  }, [geo, locate]);

  // Locate whenever the distance sort is showing without a reading, including
  // on a first visit — "near me" is the default, so the page asks for what it
  // needs (owner decision).
  //
  // `request()` reads the stored grant first, so this prompts only a visitor
  // who has not answered: a granted browser resolves silently, a blocked one
  // resolves straight to the message the alert renders. The `idle` guard is
  // what stops it re-asking after any answer — and what lets the Reset chip,
  // which returns the geolocation state to idle along with the sort, ask
  // again.
  useEffect(() => {
    if (coords || sort !== "distance" || geo.status !== "idle") return;
    requestLocation();
  }, [sort, coords, geo.status, requestLocation]);

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
  //
  // Contract: this effect reassigns `selectedId` ONLY when the current
  // selection is missing from `mapEntries` (or on the initial null). The map's
  // selection-sync surfaces depend on that to tell a user tap from a
  // reassign — `useUserSelectionChange` in `map-ui.tsx` (the carousel's
  // scroll-into-view and the live map's pan) treats a change whose previous
  // selection vanished from the entries as this effect's doing, not a tap.
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
   * Change the server-side sort, resetting to page 1. The chosen sort lands in
   * the URL immediately; picking "Near me" without a reading also asks the
   * browser for one, and the answer arrives as route state, never as a param.
   *
   * A refused or failed reading no longer flips the control back: the server
   * degrades "near me" to the fallback sort (`DISTANCE_FALLBACK_SORT` in
   * `sort.ts`) and the page says so, which beats silently swapping the
   * selection the visitor just made.
   */
  function changeSort(next: BrowseSort) {
    navigate({ search: (prev) => ({ ...prev, page: 1, sort: next }) });
    if (next !== "distance") {
      geo.reset();
      return;
    }
    if (!coords) requestLocation();
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
   * search, quick chips, taxonomy attrs, saved mode, sort, radius, page, and
   * the client-only List/Map `?view=`.
   * `search: () => ({})` is a deliberate full replace: every param goes away,
   * `validateSearch` refills `BROWSE_SEARCH_DEFAULTS`, and `stripSearchParams`
   * keeps the URL bare — exactly like a fresh `/` visit. That fresh-visit
   * semantic is why `view` resets too, even though `view` alone never lights
   * the Reset chip (see the note in browse-search.ts). `geo.reset()` mirrors
   * `changeSort`'s non-distance branch so a stale prompt/error state doesn't
   * linger. The visitor's location survives: they have not moved, and a fresh
   * visit would only ask the browser for it again.
   */
  function resetAll() {
    setSearchInput("");
    lastPushedQ.current = "";
    geo.reset();
    navigate({ search: () => ({}) });
  }

  // Whether any filter is active — decides empty vs no-results. Uses the URL
  // `?q=` (the server-applied search), not the in-flight local input.
  const anyFilterActive = qParam.trim() !== "" || quick.length > 0 || attrs.length > 0 || !bot;

  // Whether any browse search param is off its default — gates the "Reset"
  // chip. Broader than `anyFilterActive` above: this also covers the saved
  // mode, sort, radius and page, none of which affect whether results are
  // showing. Delegates to the shared
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
  });

  // What the page says about location, taken from what the server actually
  // did rather than from the browser's permission state — only the response
  // knows whether the coarse request anchor stood in for a reading.
  //
  // Anchored on the request's approximate location: distances are real but
  // measured from the area, so say so instead of implying a precise fix.
  const coarselyAnchored = data.locationSource === "coarse" && data.effectiveSort === "distance";
  // No anchor at all: the results are the fallback order, and `geo.error`
  // carries the reason (refused, blocked, unavailable). Suppressed while a
  // coarse anchor is carrying the sort, where that reason would misdescribe
  // what the visitor is looking at.
  const locationAlert = sort === "distance" && data.locationSource === "none" ? geo.error : null;

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
            {geo.status === "prompting"
              ? "Finding your location…"
              : coarselyAnchored
                ? "Sorted from your general area. Turn on location for exact distances."
                : null}
          </output>
          {locationAlert ? (
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
              {locationAlert}
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
          scroll region), so this is a plain block; its bottom padding is the
          only spacer between the results and the site footer. `relative`
          anchors the map's absolutely-positioned backdrop + pins. */}
      <div className="relative bg-background px-gutter pb-section pt-4">
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
