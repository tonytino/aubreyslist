/**
 * The browse/directory search-param schema — the one definition of how the
 * directory's URL params are validated. Shared so the directory route (`/`)
 * and the `/listings` → `/` redirect stub validate identically, and the
 * redirect forwards a canonical search.
 *
 * Client-safe: pure Zod + client-safe constants, no db/server-only imports.
 * Lives in a shared module (not exported from a route file) so `tsr generate`
 * never reasons about a non-route export on a route module.
 */

import { z } from "zod";
import { DEFAULT_RADIUS_MILES, parseRadiusMiles } from "~/listings/distance";
import { BROWSE_SORT_VALUES, type BrowseSort, DEFAULT_BROWSE_SORT } from "~/listings/sort";
import type { GeolocationStatus } from "~/listings/use-geolocation";

/**
 * The directory's content-view vocabulary (List vs Map). Kept here so the
 * schema and `ViewToggle` share one definition instead of two hand-kept
 * `"list" | "map"` literals drifting apart.
 */
export const DIRECTORY_VIEW_VALUES = ["list", "map"] as const;

/**
 * Cap on the map view's appended "Load more" pages (`?pages=`). With the base
 * page that bounds the map at `(1 + cap) * pageSize` pins/mini-cards — enough
 * to sweep a wide radius, small enough to keep marker count and memory sane.
 * Someone who exhausts it can narrow the radius or search near a different
 * spot. Lives here so the schema's clamp and the accumulation hook
 * (`use-map-pages.ts`) share one bound.
 */
export const MAX_MAP_EXTRA_PAGES = 5;

/**
 * The shape of a `?sel=` listing id: id characters only (UUID alphabet plus
 * headroom for a future id scheme), bounded length, never freeform text —
 * anything else is garbage and degrades to absent.
 */
const SELECTED_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The map-view params that describe cards of the current result set: the
 * `?pages=` accumulation and the `?sel=` selection. Spread into every
 * navigation that changes the result set — anything that resets `page: 1`,
 * plus the pager's page links — so a new set never inherits an accumulation
 * or a selection that belonged to the old one.
 */
export const MAP_VIEW_PARAMS_CLEARED = { pages: undefined, sel: undefined } as const;

/**
 * True while the browse result set's distance anchor is still resolving
 * client-side: the "near me" sort with no searched area and no reading yet,
 * and the browser's geolocation answer still possible (anything short of an
 * error can still deliver coords). While true, the visible result set is
 * transient — a reading will re-anchor it without any navigation — so
 * judgements about what the set contains must wait. The map route gates its
 * stale-`?sel=` strip on this: judging a restored selection against the
 * pre-reading window would destroy a restore that succeeds moments later.
 */
export function isBrowseAnchorPending(input: {
  sort: BrowseSort;
  areaActive: boolean;
  coordsKnown: boolean;
  geoStatus: GeolocationStatus;
}): boolean {
  return (
    input.sort === "distance" &&
    !input.areaActive &&
    !input.coordsKnown &&
    input.geoStatus !== "error"
  );
}

/** One directory content view: the results list or the (placeholder) map. */
export type DirectoryView = (typeof DIRECTORY_VIEW_VALUES)[number];

/**
 * The canonical default of every browse search param that carries one.
 *
 * Load-bearing in two places that must agree: the `browseSearchSchema`
 * `.catch()/.default()` below (what a missing/garbage param degrades to) and
 * the route's `stripSearchParams(BROWSE_SEARCH_DEFAULTS)` middleware, which
 * drops any outbound param whose value equals its default. The two must never
 * drift; `browse-search.test.ts` asserts this map equals
 * `browseSearchSchema.parse({})` minus `lat`/`lng`. Those are omitted on
 * purpose: `.optional().catch(undefined)` params are already absent from the
 * URL when unset and need no strip entry.
 */
export const BROWSE_SEARCH_DEFAULTS = {
  page: 1,
  attrs: "",
  q: "",
  sort: DEFAULT_BROWSE_SORT,
  radius: DEFAULT_RADIUS_MILES,
  // Quick filters: a comma-set string like `attrs`; "" means none.
  quick: "",
  // Server-side "Saved" filter: off by default.
  saved: false,
  // Curator-bot participation: default includes suggestions. `?bot=false`
  // reverts filters to community-evidence-only matching and hides
  // bot-suggested-only listings (a live suggestion with no community
  // evidence on any claim).
  bot: true,
  // List/Map content-view toggle. Client-only: it changes no server query, so
  // it is deliberately absent from `loaderDeps` in `app/routes/index.tsx` —
  // flipping it never refetches or resets `page`. It still lives in the URL
  // (shareable/restorable per the Hard Rule) and in this map so
  // `stripSearchParams` keeps a bare/list visit at a clean `/`.
  view: "list" as DirectoryView,
} as const;

/**
 * The raw browse search values relevant to "is anything off its default" —
 * one field per {@link BROWSE_SEARCH_DEFAULTS} entry, plus the no-default
 * area-search origin (active whenever either coordinate is set).
 */
export interface BrowseSearchLike {
  page: number;
  attrs: string;
  q: string;
  sort: BrowseSort;
  radius: number;
  quick: string;
  saved: boolean;
  bot: boolean;
  areaLat?: number | undefined;
  areaLng?: number | undefined;
}
// `view` (the List/Map toggle) is deliberately not part of this interface or
// `isAnyBrowseFilterActive`. It's a content-view choice, not a filter/sort
// constraint, so Map view alone never lights the "Reset" chip. The contract is
// asymmetric on the write side: when Reset is clicked, `resetAll` does a full
// search replace (fresh-visit semantics), so `view` returns to "list" too.
// `view` stays a full BROWSE_SEARCH_DEFAULTS entry so `stripSearchParams`
// keeps it out of the URL at rest.

/**
 * True when at least one browse search param is off its default — gates the
 * directory's "Reset" chip.
 *
 * Compared field-by-field against {@link BROWSE_SEARCH_DEFAULTS} — the same
 * map `stripSearchParams` strips the URL against — so this can never drift
 * from what counts as "at rest". The visitor's location is not a search param
 * at all (it lives in memory for the tab), so it never lights the chip.
 */
export function isAnyBrowseFilterActive(search: BrowseSearchLike): boolean {
  return (
    search.page !== BROWSE_SEARCH_DEFAULTS.page ||
    search.attrs !== BROWSE_SEARCH_DEFAULTS.attrs ||
    search.q !== BROWSE_SEARCH_DEFAULTS.q ||
    search.sort !== BROWSE_SEARCH_DEFAULTS.sort ||
    search.radius !== BROWSE_SEARCH_DEFAULTS.radius ||
    search.quick !== BROWSE_SEARCH_DEFAULTS.quick ||
    search.saved !== BROWSE_SEARCH_DEFAULTS.saved ||
    search.bot !== BROWSE_SEARCH_DEFAULTS.bot ||
    // The pair, matching the schema's half-pair normalization: only a
    // complete origin makes the area search active.
    (search.areaLat !== undefined && search.areaLng !== undefined)
  );
}

const rawBrowseSearchSchema = z.object({
  // `.catch(...).default(...)` on every defaulted field: `.catch` degrades
  // garbage to the default; `.default` keeps the param optional on the input
  // side under zod 4 — without it every `navigate`/`<Link>` would have to
  // spell out `page` and `sort`.
  page: z
    .number()
    .int()
    .min(1)
    .catch(BROWSE_SEARCH_DEFAULTS.page)
    .default(BROWSE_SEARCH_DEFAULTS.page),
  /** Comma-separated taxonomy attributes; "" means no filter. */
  attrs: z.string().catch(BROWSE_SEARCH_DEFAULTS.attrs).default(BROWSE_SEARCH_DEFAULTS.attrs),
  // Free-text search over name + address. URL-driven so the search covers all
  // listings server-side (not just the loaded page) and stays linkable and
  // back/forward-correct. "" means no text constraint. Bounded to the server's
  // accepted length; garbage degrades to "".
  q: z.string().max(256).catch(BROWSE_SEARCH_DEFAULTS.q).default(BROWSE_SEARCH_DEFAULTS.q),
  // A plain enum, not a `.transform()`, so the value round-trips cleanly when
  // the router re-serializes search state on navigation. Unknown tokens
  // degrade to the "near me" default via `.catch`.
  sort: z
    .enum(BROWSE_SORT_VALUES as [BrowseSort, ...BrowseSort[]])
    .catch(BROWSE_SEARCH_DEFAULTS.sort)
    .default(BROWSE_SEARCH_DEFAULTS.sort),
  // The visitor's coordinates are deliberately NOT search params. Location is
  // an input to the query, not a view to share: in the URL it would ride into
  // browser history, referrers, and any pasted link. It lives in route state
  // for the life of the tab and reaches the server only as a rounded
  // server-function argument. `?sort=` alone makes the view linkable, and the
  // recipient is anchored by their own location.
  //
  // Distance-radius filter. `parseRadiusMiles` coerces any value to a valid
  // DISTANCE_RADIUS_OPTIONS option, so it always round-trips as a real radius.
  // The origin is not in the URL either: the server anchors it on whatever
  // located the sort, falling back to Union Station.
  radius: z
    .number()
    .transform((value) => parseRadiusMiles(value))
    .catch(BROWSE_SEARCH_DEFAULTS.radius)
    .default(BROWSE_SEARCH_DEFAULTS.radius),
  // Quick filters: a comma-set of tokens, exactly like `attrs`. The schema
  // stores the raw string; `parseQuick` at the route validates, de-dupes, and
  // collapses groups. "" means no quick filter; garbage degrades to "".
  quick: z.string().catch(BROWSE_SEARCH_DEFAULTS.quick).default(BROWSE_SEARCH_DEFAULTS.quick),
  // Server-side "Saved" filter: `?saved=1`/`?saved=true` switches the
  // directory to the signed-in viewer's favorites, applied server-side so
  // pagination and the honest total cover the full favorites set. Coerced
  // from the router's parsed value (boolean, number, or string forms) to a
  // plain boolean; anything else degrades to `false`.
  saved: z
    .union([z.boolean(), z.number(), z.string()])
    .transform((value) => value === true || value === 1 || value === "1" || value === "true")
    .catch(BROWSE_SEARCH_DEFAULTS.saved)
    .default(BROWSE_SEARCH_DEFAULTS.saved),
  // Curator-bot participation flag: `?bot=false` (or `0`) excludes live bot
  // suggestions from filter matching and hides bot-suggested-only listings.
  // Anything else, including absence, degrades to the inclusive default.
  // Mirrors `saved`'s coercion — the string forms arrive from hand-edited
  // links.
  bot: z
    .union([z.boolean(), z.number(), z.string()])
    .transform((value) => !(value === false || value === 0 || value === "0" || value === "false"))
    .catch(BROWSE_SEARCH_DEFAULTS.bot)
    .default(BROWSE_SEARCH_DEFAULTS.bot),
  // The List/Map content-view toggle (`?view=`). Client-only UI state — see
  // the note on `BROWSE_SEARCH_DEFAULTS.view`. Still validated + URL-driven
  // per the Hard Rule; an unknown token degrades to "list" via `.catch`.
  view: z
    .enum(DIRECTORY_VIEW_VALUES)
    .catch(BROWSE_SEARCH_DEFAULTS.view)
    .default(BROWSE_SEARCH_DEFAULTS.view),
  // The "Search near here" origin: the map center the visitor deliberately
  // framed before tapping the button. In the URL — unlike the visitor's own
  // coordinates — because a searched area is a chosen view of the directory,
  // not a position: it is exactly the state a pasted link should restore, and
  // it arrives pre-rounded (`coarsenCoords`) so it never encodes a precise
  // fix. No default: absent means "no area override" and needs no strip
  // entry. WGS84-bounded; garbage degrades to absent. The server threads it
  // as the radius-filter origin (`originLat`/`originLng`).
  areaLat: z.number().finite().min(-90).max(90).optional().catch(undefined),
  areaLng: z.number().finite().min(-180).max(180).optional().catch(undefined),
  // Map view only: how many extra "Load more" pages ride on top of the base
  // page. In the URL because the accumulated carousel is a chosen view of the
  // directory — Back and a pasted link must restore all of it, not just page
  // one. Client-only (the base server page is still `?page=`): excluded from
  // `loaderDeps`, written with `replace: true` + `resetScroll: false`, and
  // stripped alongside `sel` by every navigation that changes the result set.
  // No default: absent means no extra pages and needs no strip entry. Values
  // past the cap clamp to it; garbage degrades to absent.
  pages: z
    .number()
    .int()
    .min(0)
    .transform((value) => Math.min(value, MAX_MAP_EXTRA_PAGES))
    .optional()
    .catch(undefined),
  // Map view only: the selected listing's id. A selection is a chosen view of
  // the directory (shareable, restorable on Back), so it lives in the URL —
  // written on every pin/card tap with `replace: true` + `resetScroll: false`
  // and stripped alongside `pages` on result-set changes. Untrusted input:
  // only a bounded id-shaped string passes (`SELECTED_ID_PATTERN`); anything
  // else degrades to absent, and an id that matches no loaded listing is
  // dropped by the route.
  sel: z.string().regex(SELECTED_ID_PATTERN).optional().catch(undefined),
});

export const browseSearchSchema = rawBrowseSearchSchema.transform((search) => {
  // A lone area coordinate (a hand-edited link) cannot anchor an area, so it
  // normalizes away at the boundary — downstream code never sees a half pair.
  if ((search.areaLat === undefined) !== (search.areaLng === undefined)) {
    return { ...search, areaLat: undefined, areaLng: undefined };
  }
  return search;
});
