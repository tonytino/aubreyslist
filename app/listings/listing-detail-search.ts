/**
 * The listing-detail route's search-param schema.
 *
 * Which evidence tab is open is shareable/restorable UI state, so per the
 * Hard Rule (AGENTS.md → "selected tab") it lives in the URL as a validated
 * `?tab=` param — never route-level `useState`. Mirrors `browse-search.ts`:
 * one schema + one defaults map, referenced by the schema's
 * `.catch()/.default()` and the route's `stripSearchParams(...)` so the
 * default tab never appears in the bar.
 *
 * Client-safe: pure Zod, no db/server-only imports. Lives in a shared module
 * (not exported from the route file) so `tsr generate` never reasons about a
 * non-route export.
 */

import { z } from "zod";

/** The evidence-panel tabs, in display order. */
export const LISTING_DETAIL_TABS = ["claims", "incidents"] as const;
export type ListingDetailTab = (typeof LISTING_DETAIL_TABS)[number];

/**
 * The canonical default for every listing-detail search param. Load-bearing
 * in two places that must agree (asserted in `listing-detail-search.test.ts`):
 * the schema's `.catch()/.default()` and the route's `stripSearchParams(...)`.
 */
export const LISTING_DETAIL_SEARCH_DEFAULTS = {
  tab: "claims",
} satisfies { tab: ListingDetailTab };

export const listingDetailSearchSchema = z.object({
  // A plain enum (round-trips cleanly on re-serialize) that degrades to the
  // default tab on any missing/garbage token.
  tab: z
    .enum(LISTING_DETAIL_TABS)
    .catch(LISTING_DETAIL_SEARCH_DEFAULTS.tab)
    .default(LISTING_DETAIL_SEARCH_DEFAULTS.tab),
});
