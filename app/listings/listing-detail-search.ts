/**
 * The listing-detail route's search-param schema (AUB-131).
 *
 * The detail page's evidence panel is a tabbed Community-claims / Incident-reports
 * switch. Which tab is open is SHAREABLE / restorable UI state, so per the Hard
 * Rule (AGENTS.md → "selected tab") it lives in the URL as a validated `?tab=`
 * param — never route-level `useState`. This mirrors the browse route's
 * `browse-search.ts` shape: one schema + one `*_DEFAULTS` map, referenced by both
 * the schema's `.catch()/.default()` AND the route's `stripSearchParams(...)`
 * middleware so the default tab never appears in the bar.
 *
 * CLIENT-SAFE: pure Zod, no `db`/server-only imports. Lives in a shared module
 * (not exported from the route file) so `tsr generate` never reasons about a
 * non-route export.
 */

import { z } from "zod";

/** The evidence-panel tabs, in display order. */
export const LISTING_DETAIL_TABS = ["claims", "incidents"] as const;
export type ListingDetailTab = (typeof LISTING_DETAIL_TABS)[number];

/**
 * The canonical default for every listing-detail search param. Load-bearing in
 * two places that MUST agree (asserted in `listing-detail-search.test.ts`): the
 * schema's `.catch()/.default()` and the route's `stripSearchParams(...)`.
 */
export const LISTING_DETAIL_SEARCH_DEFAULTS = {
  tab: "claims",
} satisfies { tab: ListingDetailTab };

export const listingDetailSearchSchema = z.object({
  // `?tab=` mirrors the browse `?sort=` pattern: a plain enum (round-trips cleanly
  // on re-serialize) that degrades to the default tab on any missing/garbage token.
  tab: z
    .enum(LISTING_DETAIL_TABS)
    .catch(LISTING_DETAIL_SEARCH_DEFAULTS.tab)
    .default(LISTING_DETAIL_SEARCH_DEFAULTS.tab),
});
