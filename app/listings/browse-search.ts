/**
 * The browse/directory search-param schema — the ONE definition of how the
 * directory's URL params (`?page=`, `?attrs=`, `?sort=`, `?q=`, `?lat=`/`?lng=`,
 * `?radius=`, `?quick=`, `?saved=`, `?bot=`, `?view=`) are validated. Shared so
 * BOTH the directory route (now `/`, the home page) and the `/listings` → `/`
 * redirect stub validate the incoming search identically, and the redirect
 * forwards a well-formed, canonical search.
 *
 * CLIENT-SAFE: pure Zod + client-safe constants (`~/listings/sort`,
 * `~/listings/distance`). No `db` client / server-only imports. Lives in a shared
 * module (not exported from a route file) so `tsr generate` never has to reason
 * about a non-route export on a route module.
 */

import { z } from "zod";
import { DEFAULT_RADIUS_MILES, parseRadiusMiles } from "~/listings/distance";
import { BROWSE_SORT_VALUES, type BrowseSort, DEFAULT_BROWSE_SORT } from "~/listings/sort";

/**
 * The directory's content-view vocabulary (List vs Map, AUB-61 Phase 2b). Kept
 * here (mirroring `sort.ts`'s canonical-registry pattern) so the schema and
 * `ViewToggle` share ONE definition instead of two hand-kept `"list" | "map"`
 * literals drifting apart. `ViewToggle.tsx` imports `DirectoryView` from here.
 */
export const DIRECTORY_VIEW_VALUES = ["list", "map"] as const;

/** One directory content view: the results list or the (placeholder) map. */
export type DirectoryView = (typeof DIRECTORY_VIEW_VALUES)[number];

/**
 * The canonical DEFAULT value of every browse search param that carries one.
 *
 * SINGLE SOURCE OF TRUTH, load-bearing in two places that MUST agree:
 *  1. the `browseSearchSchema` `.catch()/.default()` below (what a missing/garbage
 *     param degrades to), and
 *  2. the route's `stripSearchParams(BROWSE_SEARCH_DEFAULTS)` middleware
 *     (`app/routes/index.tsx`), which drops any outbound param whose value deeply
 *     equals its default — so the URL never carries redundant `?page=1&sort=alpha&
 *     radius=25` noise at rest.
 *
 * Because `stripSearchParams` compares against these EXACT values, the two must
 * never drift; `browse-search.test.ts` asserts this map equals
 * `browseSearchSchema.parse({})` (minus the always-optional `lat`/`lng`). `lat`/
 * `lng` are omitted deliberately — they are `.optional().catch(undefined)`, so
 * they are already absent from the URL when unset and need no strip entry.
 */
export const BROWSE_SEARCH_DEFAULTS = {
  page: 1,
  attrs: "",
  q: "",
  sort: DEFAULT_BROWSE_SORT,
  radius: DEFAULT_RADIUS_MILES,
  // Prebuilt quick filters (AUB-135/AUB-140): a comma-set string like `attrs`,
  // defaulting to "" (no quick filter) so `stripSearchParams` drops it at rest.
  quick: "",
  // SERVER-SIDE "Saved" filter (AUB-129 / F11): defaults to off, so a bare visit
  // never carries `?saved=` and `stripSearchParams` drops it at rest.
  saved: false,
  // Curator-bot suggestions participate in the browse (AUB-31): default ON
  // (`true` = include), so a bare visit never carries `?bot=` and
  // `stripSearchParams` drops it at rest. `?bot=false` (the "Hide bot
  // suggestions" chip) reverts filters to community-evidence-only matching AND
  // hides bot-suggested-only listings (a live suggestion with no community
  // evidence on any claim) from the results.
  bot: true,
  // The List/Map content-view toggle (owner override of AUB-164 — the Map
  // segment is back on the public directory; see ViewToggle.tsx). CLIENT-ONLY:
  // it changes no server query (unlike every other entry in this map), so it is
  // deliberately absent from `loaderDeps` in `app/routes/index.tsx` — flipping it
  // never refetches or resets `page`. It still belongs in the URL (shareable/
  // restorable per the Hard Rule) and in this map so `stripSearchParams` keeps a
  // bare/list visit at a clean `/`.
  view: "list" as DirectoryView,
} as const;

/**
 * The raw browse search values relevant to "is anything filtered/sorted/paged
 * away from a bare visit" — one field per {@link BROWSE_SEARCH_DEFAULTS} entry,
 * plus the always-optional near-me coordinate pair (which has no default entry
 * because it's absent by default rather than defaulting to a value).
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
// NOTE: `view` (the List/Map toggle) is deliberately NOT part of this interface
// or `isAnyBrowseFilterActive` below. It's a content-VIEW choice, not a filter/
// sort/search constraint — so being in Map view ALONE never lights the "Reset"
// chip (which is scoped to backing out of a stacked search + quick filter +
// saved mode + sort + radius + page; see its call site). The contract is
// deliberately asymmetric on the WRITE side, though: when Reset IS shown (some
// filter is active) and clicked, `resetAll` in `app/routes/index.tsx` does a
// FULL search replace — fresh-visit semantics — so it returns `view` to "list"
// along with everything else. `view` is still a full BROWSE_SEARCH_DEFAULTS
// entry so `stripSearchParams` keeps it out of the URL at rest.

/**
 * True when at least one browse search param is off its default — gates the
 * directory's "Reset" chip (repo-owner mobile feedback: previously only the
 * taxonomy filter's own "Clear" existed, with no single affordance to back out
 * of a stacked search + quick filter + saved mode + sort + radius + page).
 *
 * Compared field-by-field against {@link BROWSE_SEARCH_DEFAULTS} — the SAME map
 * `stripSearchParams` strips the URL against — so this can never drift from what
 * counts as "at rest". A set `lat`/`lng` pair (no default entry, always-optional)
 * means the visitor opted into "near me", so it counts as active too.
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
  // `.catch(...).default(...)` (like every defaulted sibling below): `.catch`
  // degrades garbage to the default, `.default` keeps the param OPTIONAL on the
  // INPUT side under zod 4 (zod 3 inferred catch-only params as optional inputs;
  // zod 4 does not, which would force every `navigate`/`<Link>` to spell out
  // `page` and `sort`). Output value for an omitted/garbage param is identical.
  page: z
    .number()
    .int()
    .min(1)
    .catch(BROWSE_SEARCH_DEFAULTS.page)
    .default(BROWSE_SEARCH_DEFAULTS.page),
  /** Comma-separated taxonomy attributes (#35); defaults to "" (no filter). */
  attrs: z.string().catch(BROWSE_SEARCH_DEFAULTS.attrs).default(BROWSE_SEARCH_DEFAULTS.attrs),
  // Free-text search over name + address (#34). URL-driven like page/attrs/sort so
  // the search is SERVER-COMPLETE (covers ALL listings, not just the loaded page),
  // linkable/shareable, and back/forward-correct. Empty string → no text
  // constraint. Bounded to the server's accepted length; garbage degrades to "".
  q: z.string().max(256).catch(BROWSE_SEARCH_DEFAULTS.q).default(BROWSE_SEARCH_DEFAULTS.q),
  // `?sort=` mirrors the `?page=` URL-param pattern (#36): linkable, back/forward
  // works. A plain enum (NOT a `.transform()`) so the value round-trips cleanly
  // when the router re-serializes search state on navigation; unknown/garbage
  // tokens degrade to the stable alphabetical default via `.catch`.
  // `.default(...)` added alongside `.catch(...)` for the same zod-4 input-
  // optionality reason as `page` above; unknown tokens still degrade via `.catch`.
  sort: z
    .enum(BROWSE_SORT_VALUES as [BrowseSort, ...BrowseSort[]])
    .catch(BROWSE_SEARCH_DEFAULTS.sort)
    .default(BROWSE_SEARCH_DEFAULTS.sort),
  // The user's location for the "near me" distance sort (#37), kept in the URL
  // (so a distance-sorted view is linkable/back-forwardable like the rest).
  lat: z.number().finite().min(-90).max(90).optional().catch(undefined),
  lng: z.number().finite().min(-180).max(180).optional().catch(undefined),
  // Distance-radius FILTER (user feedback #7). URL-driven like the rest so a
  // narrowed view is linkable/back-forwardable. `parseRadiusMiles` coerces any
  // value to a valid DISTANCE_RADIUS_OPTIONS option (garbage/off-list → the
  // DEFAULT_RADIUS_MILES), so it always round-trips as a real radius. The origin
  // is NOT in the URL — it's derived at render time from the user's live coords
  // (or Union Station), so a shared link re-anchors to the recipient's location.
  radius: z
    .number()
    .transform((value) => parseRadiusMiles(value))
    .catch(BROWSE_SEARCH_DEFAULTS.radius)
    .default(BROWSE_SEARCH_DEFAULTS.radius),
  // Prebuilt quick filters (AUB-135/AUB-140): a comma-set of tokens, exactly like
  // `attrs`. The raw string is stored here and validated/deduped/group-collapsed by
  // `parseQuick` at the route (mirroring how `attrs` defers to `parseAttrs`), so
  // the schema stays a plain string. Defaults to "" (no quick filter), which
  // `stripSearchParams` drops from the URL at rest; garbage degrades to "".
  quick: z.string().catch(BROWSE_SEARCH_DEFAULTS.quick).default(BROWSE_SEARCH_DEFAULTS.quick),
  // SERVER-SIDE "Saved" filter (AUB-129 / F11): `?saved=1` (or `?saved=true`)
  // switches the directory to the signed-in viewer's favorites, driven
  // server-side so pagination + the honest total cover the FULL favorites set.
  // URL-driven like the rest so a saved view is linkable/back-forwardable.
  // Coerced from the router's parsed value (boolean `true`, numeric `1`, or the
  // string forms) to a plain boolean; anything else degrades to `false`.
  saved: z
    .union([z.boolean(), z.number(), z.string()])
    .transform((value) => value === true || value === 1 || value === "1" || value === "true")
    .catch(BROWSE_SEARCH_DEFAULTS.saved)
    .default(BROWSE_SEARCH_DEFAULTS.saved),
  // Curator-bot suggestion PARTICIPATION flag (AUB-31): `?bot=false` (or `0`)
  // excludes live bot suggestions from filter matching AND hides
  // bot-suggested-only listings from the results ("Hide bot suggestions"
  // chip); anything else — including absence — degrades to the inclusive
  // default, which `stripSearchParams` keeps out of the URL at rest. Mirrors
  // `saved`'s coercion (the router parses `false`/`0` to their JS values, but
  // the string forms arrive from hand-edited links).
  bot: z
    .union([z.boolean(), z.number(), z.string()])
    .transform((value) => !(value === false || value === 0 || value === "0" || value === "false"))
    .catch(BROWSE_SEARCH_DEFAULTS.bot)
    .default(BROWSE_SEARCH_DEFAULTS.bot),
  // The List/Map content-view toggle (`?view=`). CLIENT-ONLY UI state — see the
  // note on `BROWSE_SEARCH_DEFAULTS.view` above and `app/routes/index.tsx` (it is
  // NOT in `loaderDeps`; changing it never refetches or resets `page`). Still
  // validated + URL-driven per the Hard Rule (shareable/restorable view state):
  // an unknown/garbage token degrades to the stable "list" default via `.catch`.
  view: z
    .enum(DIRECTORY_VIEW_VALUES)
    .catch(BROWSE_SEARCH_DEFAULTS.view)
    .default(BROWSE_SEARCH_DEFAULTS.view),
});
