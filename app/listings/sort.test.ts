import { describe, expect, it } from "vitest";
import {
  BROWSE_SORT_OPTIONS,
  BROWSE_SORT_VALUES,
  DEFAULT_BROWSE_SORT,
  DISTANCE_FALLBACK_SORT,
  isBrowseSort,
  parseBrowseSort,
} from "./sort";

describe("browse sort registry", () => {
  it("defaults to near me (the first option)", () => {
    expect(DEFAULT_BROWSE_SORT).toBe("distance");
    expect(BROWSE_SORT_OPTIONS[0].value).toBe("distance");
  });

  it("exposes the expected options in display order", () => {
    expect(BROWSE_SORT_VALUES).toEqual(["distance", "alpha", "trust", "recency"]);
  });

  it("degrades the distance sort to a real, non-distance option", () => {
    // The fallback has to be orderable without any location, so it can never
    // be the distance sort itself.
    expect(DISTANCE_FALLBACK_SORT).toBe("recency");
    expect(BROWSE_SORT_VALUES).toContain(DISTANCE_FALLBACK_SORT);
    expect(DISTANCE_FALLBACK_SORT).not.toBe("distance");
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
    expect(isBrowseSort("distance")).toBe(true);
  });

  it("rejects unknown / non-string values", () => {
    expect(isBrowseSort("nearby")).toBe(false);
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

  it("degrades unknown tokens to the default sort", () => {
    expect(parseBrowseSort("nonsense")).toBe(DEFAULT_BROWSE_SORT);
    expect(parseBrowseSort(undefined)).toBe(DEFAULT_BROWSE_SORT);
    expect(parseBrowseSort(null)).toBe(DEFAULT_BROWSE_SORT);
  });
});
