/**
 * The browse/directory search-param schema — the ONE definition of how the
 * directory's URL params (`?page=`, `?attrs=`, `?sort=`, `?q=`, `?lat=`/`?lng=`,
 * `?radius=`) are validated. Shared so BOTH the directory route (now `/`, the
 * home page) and the `/listings` → `/` redirect stub validate the incoming
 * search identically, and the redirect forwards a well-formed, canonical search.
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
  quick: "",
} as const;

export const browseSearchSchema = z.object({
  page: z.number().int().min(1).catch(BROWSE_SEARCH_DEFAULTS.page),
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
  sort: z
    .enum(BROWSE_SORT_VALUES as [BrowseSort, ...BrowseSort[]])
    .catch(BROWSE_SEARCH_DEFAULTS.sort),
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
});
