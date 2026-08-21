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
 * The schema's default/`.catch` behaviour is what makes a shared or garbage
 * link degrade gracefully instead of erroring. Every field is
 * `.catch()`-guarded, so `.parse()` never throws; these assert the fallbacks
 * are the stable, expected values.
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
    // Load-bearing invariant: `stripSearchParams(BROWSE_SEARCH_DEFAULTS)`
    // drops any outbound param whose value equals its default. If this map
    // drifts from what the schema fills for a bare visit, the URL either
    // leaks a default or strips a real value. `lat`/`lng` have no default
    // (always-optional), so they are excluded from the strip map by design.
    expect(browseSearchSchema.parse({})).toEqual(BROWSE_SEARCH_DEFAULTS);
  });

  it("passes a fully-specified, valid search through unchanged", () => {
    expect(
      browseSearchSchema.parse({
        page: 3,
        attrs: "celiac_safe_vs_gluten_friendly",
        q: "pizza",
        sort: "trust",
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
      radius: 10,
      quick: "celiac,recent",
      saved: true,
      bot: false,
      view: "map",
    });
  });

  it("validates ?view=: passes through known tokens, degrades anything else to 'list'", () => {
    // A garbage/unknown token, or the field's absence, degrades to the stable
    // "list" default via `.catch`/`.default`.
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

  it("does not accept coordinates as search params at all", () => {
    // Location is route state, not a shareable view: it must never round-trip
    // through the URL, browser history, or a pasted link.
    const parsed = browseSearchSchema.parse({ lat: -12.5, lng: 130.25 });
    expect(parsed).not.toHaveProperty("lat");
    expect(parsed).not.toHaveProperty("lng");
  });

  it("truncates nothing but rejects an over-long free-text query to empty", () => {
    expect(browseSearchSchema.parse({ q: "gluten free" }).q).toBe("gluten free");
    expect(browseSearchSchema.parse({ q: "x".repeat(257) }).q).toBe("");
  });

  it("stores the raw quick comma-string (validation/collapse deferred to parseQuick)", () => {
    // Like `attrs`, the schema keeps the raw string; `parseQuick` does the
    // vocabulary validation, de-dupe, and safety-group collapse. The schema
    // only guards the type: a non-string degrades to "" and an omitted param
    // defaults to "" (stripped from the URL).
    expect(browseSearchSchema.parse({ quick: "celiac,recent" }).quick).toBe("celiac,recent");
    expect(browseSearchSchema.parse({ quick: "bogus" }).quick).toBe("bogus"); // raw passthrough
    expect(browseSearchSchema.parse({ quick: 42 }).quick).toBe(""); // non-string → catch
    expect(browseSearchSchema.parse({}).quick).toBe(""); // default
  });

  it("coerces the bot-suggestions flag: only explicit false/0 forms exclude", () => {
    // `?bot=false` / `?bot=0` (boolean, number, or the string forms a hand-edited
    // link produces) turn bot-suggestion matching off...
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
 * {@link isAnyBrowseFilterActive} gates the directory's "Reset" chip. Covers
 * the default-at-rest case, one-param-at-a-time activation across the whole
 * browse param set, and the return to `false` at defaults.
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

  it.each<[string, Partial<BrowseSearchLike>]>([
    ["page", { page: 2 }],
    ["attrs", { attrs: "celiac_safe_vs_gluten_friendly" }],
    ["q", { q: "pizza" }],
    ["sort", { sort: "trust" }],
    ["radius", { radius: 10 }],
    ["quick", { quick: "celiac" }],
    ["saved", { saved: true }],
    ["bot (hide bot suggestions)", { bot: false }],
  ])("is true when only %s is off its default", (_label, override) => {
    expect(isAnyBrowseFilterActive({ ...AT_DEFAULT, ...override })).toBe(true);
  });

  it("is true when multiple params are stacked", () => {
    expect(
      isAnyBrowseFilterActive({ ...AT_DEFAULT, q: "pizza", saved: true, sort: "recency" })
    ).toBe(true);
  });
});
