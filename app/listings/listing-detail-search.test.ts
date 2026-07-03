import { describe, expect, it } from "vitest";
import {
  LISTING_DETAIL_SEARCH_DEFAULTS,
  LISTING_DETAIL_TABS,
  listingDetailSearchSchema,
} from "./listing-detail-search";

describe("listingDetailSearchSchema", () => {
  it("defaults an empty search to the DEFAULTS map (no drift with stripSearchParams)", () => {
    // The schema's parse-of-empty MUST equal the DEFAULTS map that the route's
    // stripSearchParams() compares against, or a default-valued param would leak
    // into the URL. See docs/agents/url-state.md.
    expect(listingDetailSearchSchema.parse({})).toEqual(LISTING_DETAIL_SEARCH_DEFAULTS);
  });

  it("accepts each known tab verbatim", () => {
    for (const tab of LISTING_DETAIL_TABS) {
      expect(listingDetailSearchSchema.parse({ tab }).tab).toBe(tab);
    }
  });

  it("degrades a garbage tab to the default rather than throwing", () => {
    expect(listingDetailSearchSchema.parse({ tab: "bogus" }).tab).toBe(
      LISTING_DETAIL_SEARCH_DEFAULTS.tab
    );
  });
});
