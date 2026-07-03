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

export const browseSearchSchema = z.object({
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
  // Distance-radius FILTER (user feedback #7). URL-driven like the rest so a
  // narrowed view is linkable/back-forwardable. `parseRadiusMiles` coerces any
  // value to a valid DISTANCE_RADIUS_OPTIONS option (garbage/off-list → the
  // DEFAULT_RADIUS_MILES), so it always round-trips as a real radius. The origin
  // is NOT in the URL — it's derived at render time from the user's live coords
  // (or Union Station), so a shared link re-anchors to the recipient's location.
  radius: z
    .number()
    .transform((value) => parseRadiusMiles(value))
    .catch(DEFAULT_RADIUS_MILES)
    .default(DEFAULT_RADIUS_MILES),
});
