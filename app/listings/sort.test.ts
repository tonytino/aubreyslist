import { describe, expect, it } from "vitest";
import {
  BROWSE_SORT_OPTIONS,
  BROWSE_SORT_VALUES,
  DEFAULT_BROWSE_SORT,
  isBrowseSort,
  parseBrowseSort,
} from "./sort";

/**
 * Tests for the browse sort registry (#36) — the small, extensible source of
 * truth shared by the route control and the loader.
 */

describe("browse sort registry", () => {
  it("defaults to alphabetical (the first, stable option)", () => {
    expect(DEFAULT_BROWSE_SORT).toBe("alpha");
    expect(BROWSE_SORT_OPTIONS[0].value).toBe("alpha");
  });

  it("exposes the expected v1 options in display order", () => {
    expect(BROWSE_SORT_VALUES).toEqual(["alpha", "trust", "recency"]);
  });

  it("gives every option a label and a help description", () => {
    for (const option of BROWSE_SORT_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.help.length).toBeGreaterThan(0);
    }
  });
});

describe("isBrowseSort", () => {
  it("accepts known tokens", () => {
    expect(isBrowseSort("alpha")).toBe(true);
    expect(isBrowseSort("trust")).toBe(true);
    expect(isBrowseSort("recency")).toBe(true);
  });

  it("rejects unknown / non-string values", () => {
    expect(isBrowseSort("distance")).toBe(false); // not added until #37
    expect(isBrowseSort("")).toBe(false);
    expect(isBrowseSort(undefined)).toBe(false);
    expect(isBrowseSort(42)).toBe(false);
  });
});

describe("parseBrowseSort", () => {
  it("passes through known tokens", () => {
    expect(parseBrowseSort("trust")).toBe("trust");
    expect(parseBrowseSort("recency")).toBe("recency");
  });

  it("degrades unknown tokens to the stable default (alphabetical)", () => {
    expect(parseBrowseSort("nonsense")).toBe("alpha");
    expect(parseBrowseSort(undefined)).toBe("alpha");
    expect(parseBrowseSort(null)).toBe("alpha");
  });
});
