import { describe, expect, it } from "vitest";
import { DEFAULT_RADIUS_MILES } from "~/listings/distance";
import { DEFAULT_BROWSE_SORT } from "~/listings/sort";
import {
  BROWSE_SEARCH_DEFAULTS,
  type BrowseSearchLike,
  browseSearchSchema,
  isAnyBrowseFilterActive,
} from "./browse-search";

/**
 * Unit tests for the shared browse/directory search-param schema. This schema is
 * the ONE definition of how the directory's URL params are validated, and it is
 * consumed by both the directory route (now `/`, the home page) and the
 * `/listings` → `/` redirect stub — so its default/`.catch` behaviour is what
 * makes a shared or garbage link degrade gracefully instead of 500ing. Every
 * field is `.catch()`-guarded, so `.parse()` never throws; these assert the
 * fallbacks are the stable, expected values.
 */
describe("browseSearchSchema", () => {
  it("fills stable defaults for an empty search (a bare visit to the directory)", () => {
    expect(browseSearchSchema.parse({})).toEqual({
      page: 1,
      attrs: "",
      q: "",
      sort: DEFAULT_BROWSE_SORT,
      lat: undefined,
      lng: undefined,
      radius: DEFAULT_RADIUS_MILES,
      quick: "",
      saved: false,
      bot: true,
      view: "list",
    });
  });

  it("keeps BROWSE_SEARCH_DEFAULTS in lockstep with the schema's parsed defaults", () => {
    // LOAD-BEARING invariant: the route's `stripSearchParams(BROWSE_SEARCH_DEFAULTS)`
    // middleware drops any outbound param whose value deeply EQUALS its default. If
    // this map ever drifts from what the schema actually fills for a bare visit, the
    // URL would either leak a default (map value too low) or strip a real value (map
    // value wrong). `lat`/`lng` are the only params with no default (always-optional,
    // absent when unset), so they are excluded from the strip map by design.
    const { lat: _lat, lng: _lng, ...parsedDefaults } = browseSearchSchema.parse({});
    expect(parsedDefaults).toEqual(BROWSE_SEARCH_DEFAULTS);
  });

  it("passes a fully-specified, valid search through unchanged", () => {
    expect(
      browseSearchSchema.parse({
        page: 3,
        attrs: "celiac_safe_vs_gluten_friendly",
        q: "pizza",
        sort: "trust",
        lat: 39.7392,
        lng: -104.9903,
        radius: 10,
        quick: "celiac,recent",
        saved: true,
        bot: false,
        view: "map",
      })
    ).toEqual({
      page: 3,
      attrs: "celiac_safe_vs_gluten_friendly",
      q: "pizza",
      sort: "trust",
      lat: 39.7392,
      lng: -104.9903,
      radius: 10,
      quick: "celiac,recent",
      saved: true,
      bot: false,
      view: "map",
    });
  });

  it("validates ?view=: passes through known tokens, degrades anything else to 'list'", () => {
    // A garbage/unknown token, or the field's absence, degrades to the stable
    // "list" default via `.catch`/`.default` (owner override of AUB-164 — the
    // Map segment is back on the public directory; see ViewToggle.tsx).
    expect(browseSearchSchema.parse({ view: "map" }).view).toBe("map");
    expect(browseSearchSchema.parse({ view: "list" }).view).toBe("list");
    expect(browseSearchSchema.parse({ view: "satellite" }).view).toBe("list");
    expect(browseSearchSchema.parse({ view: 42 }).view).toBe("list");
    expect(browseSearchSchema.parse({}).view).toBe("list");
  });

  it("degrades a non-positive or non-numeric page to 1", () => {
    expect(browseSearchSchema.parse({ page: 0 }).page).toBe(1);
    expect(browseSearchSchema.parse({ page: -5 }).page).toBe(1);
    expect(browseSearchSchema.parse({ page: 2.5 }).page).toBe(1);
    expect(browseSearchSchema.parse({ page: "nope" }).page).toBe(1);
  });

  it("degrades an unknown sort token to the default sort", () => {
    expect(browseSearchSchema.parse({ sort: "bogus" }).sort).toBe(DEFAULT_BROWSE_SORT);
    expect(browseSearchSchema.parse({ sort: 42 }).sort).toBe(DEFAULT_BROWSE_SORT);
  });

  it("keeps a valid coordinate pair but drops out-of-range or garbage lat/lng", () => {
    const valid = browseSearchSchema.parse({ lat: -12.5, lng: 130.25 });
    expect(valid.lat).toBe(-12.5);
    expect(valid.lng).toBe(130.25);

    const bad = browseSearchSchema.parse({ lat: 999, lng: "west" });
    expect(bad.lat).toBeUndefined();
    expect(bad.lng).toBeUndefined();
  });

  it("truncates nothing but rejects an over-long free-text query to empty", () => {
    expect(browseSearchSchema.parse({ q: "gluten free" }).q).toBe("gluten free");
    expect(browseSearchSchema.parse({ q: "x".repeat(257) }).q).toBe("");
  });

  it("stores the raw quick comma-string (validation/collapse deferred to parseQuick)", () => {
    // Like `attrs`, the schema keeps the raw string; `parseQuick` (tested in
    // quick.test.ts) does the vocabulary validation, de-dupe, and safety-group
    // collapse. So the schema only guards the TYPE (string), degrading a non-string
    // to "" and defaulting an omitted param to "" (so it's stripped from the URL).
    expect(browseSearchSchema.parse({ quick: "celiac,recent" }).quick).toBe("celiac,recent");
    expect(browseSearchSchema.parse({ quick: "bogus" }).quick).toBe("bogus"); // raw passthrough
    expect(browseSearchSchema.parse({ quick: 42 }).quick).toBe(""); // non-string → catch
    expect(browseSearchSchema.parse({}).quick).toBe(""); // default
  });

  it("coerces the bot-suggestions flag: only explicit false/0 forms exclude", () => {
    // `?bot=false` / `?bot=0` (boolean, number, or the string forms a hand-edited
    // link produces) turn bot-suggestion matching OFF...
    expect(browseSearchSchema.parse({ bot: false }).bot).toBe(false);
    expect(browseSearchSchema.parse({ bot: 0 }).bot).toBe(false);
    expect(browseSearchSchema.parse({ bot: "0" }).bot).toBe(false);
    expect(browseSearchSchema.parse({ bot: "false" }).bot).toBe(false);
    // ...everything else — absence, truthy forms, garbage — degrades to the
    // inclusive default (and is stripped from the URL at rest).
    expect(browseSearchSchema.parse({}).bot).toBe(true);
    expect(browseSearchSchema.parse({ bot: true }).bot).toBe(true);
    expect(browseSearchSchema.parse({ bot: "banana" }).bot).toBe(true);
  });

  it("coerces radius to a valid option, falling back to the default", () => {
    // An on-list radius passes through the transform unchanged...
    expect(browseSearchSchema.parse({ radius: 5 }).radius).toBe(5);
    // ...an off-list number is coerced to the default by the transform...
    expect(browseSearchSchema.parse({ radius: 7 }).radius).toBe(DEFAULT_RADIUS_MILES);
    // ...and a non-numeric value trips `.catch` back to the default.
    expect(browseSearchSchema.parse({ radius: "far" }).radius).toBe(DEFAULT_RADIUS_MILES);
  });
});

/**
 * Unit tests for {@link isAnyBrowseFilterActive} — the shared predicate that
 * gates the directory's "Reset" chip (repo-owner mobile feedback). Covers the
 * default-at-rest case, one-param-at-a-time activation across the WHOLE browse
 * param set (search, quick, taxonomy attrs, saved mode, sort, radius, page, and
 * the near-me coordinate pair), and that it returns to `false` once every param
 * is back at its default.
 */
describe("isAnyBrowseFilterActive", () => {
  const AT_DEFAULT: BrowseSearchLike = {
    page: BROWSE_SEARCH_DEFAULTS.page,
    attrs: BROWSE_SEARCH_DEFAULTS.attrs,
    q: BROWSE_SEARCH_DEFAULTS.q,
    sort: BROWSE_SEARCH_DEFAULTS.sort,
    radius: BROWSE_SEARCH_DEFAULTS.radius,
    quick: BROWSE_SEARCH_DEFAULTS.quick,
    saved: BROWSE_SEARCH_DEFAULTS.saved,
    bot: BROWSE_SEARCH_DEFAULTS.bot,
  };

  it("is false when every param is at its default (a bare visit)", () => {
    expect(isAnyBrowseFilterActive(AT_DEFAULT)).toBe(false);
  });

  it("is false when lat/lng are explicitly undefined (the always-optional default)", () => {
    expect(isAnyBrowseFilterActive({ ...AT_DEFAULT, lat: undefined, lng: undefined })).toBe(false);
  });

  it.each<[string, Partial<BrowseSearchLike>]>([
    ["page", { page: 2 }],
    ["attrs", { attrs: "celiac_safe_vs_gluten_friendly" }],
    ["q", { q: "pizza" }],
    ["sort", { sort: "trust" }],
    ["radius", { radius: 10 }],
    ["quick", { quick: "celiac" }],
    ["saved", { saved: true }],
    ["bot (hide bot suggestions)", { bot: false }],
    ["a near-me coordinate pair", { lat: 39.7392, lng: -104.9903 }],
  ])("is true when only %s is off its default", (_label, override) => {
    expect(isAnyBrowseFilterActive({ ...AT_DEFAULT, ...override })).toBe(true);
  });

  it("is true when multiple params are stacked", () => {
    expect(
      isAnyBrowseFilterActive({ ...AT_DEFAULT, q: "pizza", saved: true, sort: "recency" })
    ).toBe(true);
  });
});
