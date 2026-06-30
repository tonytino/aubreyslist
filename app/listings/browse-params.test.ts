import { describe, expect, it } from "vitest";
import { coordsFromSearch, parseAttrs, serializeAttrs } from "./browse-params";

/**
 * Tests for the client-safe browse URL-param helpers (#33–#37) — the shared
 * source of truth for how `?attrs=`/`?lat=`/`?lng=` are parsed and serialized.
 */

describe("parseAttrs", () => {
  it("splits a comma-separated list into valid attributes", () => {
    expect(parseAttrs("dedicated_fryer,dedicated_gf_menu")).toEqual([
      "dedicated_fryer",
      "dedicated_gf_menu",
    ]);
  });

  it("trims surrounding whitespace around each token", () => {
    expect(parseAttrs(" dedicated_fryer , dedicated_gf_menu ")).toEqual([
      "dedicated_fryer",
      "dedicated_gf_menu",
    ]);
  });

  it("de-duplicates repeated attributes (first occurrence order preserved)", () => {
    expect(parseAttrs("dedicated_fryer,dedicated_fryer,dedicated_gf_menu")).toEqual([
      "dedicated_fryer",
      "dedicated_gf_menu",
    ]);
  });

  it("drops unknown / garbage tokens, keeping the valid subset", () => {
    expect(parseAttrs("dedicated_fryer,not_a_real_attr,dedicated_gf_menu")).toEqual([
      "dedicated_fryer",
      "dedicated_gf_menu",
    ]);
  });

  it("returns an empty list for the empty string", () => {
    expect(parseAttrs("")).toEqual([]);
  });
});

describe("serializeAttrs", () => {
  it("joins a selection into the canonical comma-separated value", () => {
    expect(serializeAttrs(["dedicated_fryer", "dedicated_gf_menu"])).toBe(
      "dedicated_fryer,dedicated_gf_menu"
    );
  });

  it("serializes the empty selection to the empty string", () => {
    expect(serializeAttrs([])).toBe("");
  });

  it("round-trips through parseAttrs", () => {
    const attrs = ["dedicated_fryer", "dedicated_gf_menu", "gf_substitutes"] as const;
    expect(parseAttrs(serializeAttrs(attrs))).toEqual([...attrs]);
  });
});

describe("coordsFromSearch", () => {
  it("returns a coord pair when both lat and lng are present", () => {
    expect(coordsFromSearch(39.7392, -104.9903)).toEqual({ lat: 39.7392, lng: -104.9903 });
  });

  it("returns undefined when only lat is present", () => {
    expect(coordsFromSearch(39.7392, undefined)).toBeUndefined();
  });

  it("returns undefined when only lng is present", () => {
    expect(coordsFromSearch(undefined, -104.9903)).toBeUndefined();
  });

  it("returns undefined when both are undefined", () => {
    expect(coordsFromSearch(undefined, undefined)).toBeUndefined();
  });

  it("treats a 0/0 pair as a complete pair (the falsy-zero edge)", () => {
    expect(coordsFromSearch(0, 0)).toEqual({ lat: 0, lng: 0 });
  });
});
