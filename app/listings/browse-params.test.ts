import { describe, expect, it } from "vitest";
import { parseAttrs, serializeAttrs } from "./browse-params";

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
