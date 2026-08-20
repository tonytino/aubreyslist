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

/**
 * The directory's content-view vocabulary (List vs Map). Kept here so the
 * schema and `ViewToggle` share one definition instead of two hand-kept
 * `"list" | "map"` literals drifting apart.
 */
export const DIRECTORY_VIEW_VALUES = ["list", "map"] as const;

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
 * one field per {@link BROWSE_SEARCH_DEFAULTS} entry, plus the always-optional
 * near-me coordinate pair (absent by default, so no defaults entry).
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
  lat?: number | undefined;
  lng?: number | undefined;
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
 * from what counts as "at rest". A set `lat`/`lng` pair means the visitor
 * opted into "near me", so it counts as active too.
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
    search.lat !== undefined ||
    search.lng !== undefined
  );
}

export const browseSearchSchema = z.object({
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
  // degrade to the stable alphabetical default via `.catch`.
  sort: z
    .enum(BROWSE_SORT_VALUES as [BrowseSort, ...BrowseSort[]])
    .catch(BROWSE_SEARCH_DEFAULTS.sort)
    .default(BROWSE_SEARCH_DEFAULTS.sort),
  // The user's location for the "near me" distance sort, kept in the URL so a
  // distance-sorted view is linkable and back/forward-correct.
  lat: z.number().finite().min(-90).max(90).optional().catch(undefined),
  lng: z.number().finite().min(-180).max(180).optional().catch(undefined),
  // Distance-radius filter. `parseRadiusMiles` coerces any value to a valid
  // DISTANCE_RADIUS_OPTIONS option, so it always round-trips as a real radius.
  // The origin is not in the URL — it's derived at render time from the user's
  // live coords (or Union Station), so a shared link re-anchors to the
  // recipient's location.
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
});
