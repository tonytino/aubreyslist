import { describe, expect, it } from "vitest";
import {
  applyQuickToggle,
  EXCLUSIVE_QUICK_GROUPS,
  parseQuick,
  QUICK_FILTER_GROUPS,
  QUICK_FILTER_VALUES,
  serializeQuick,
} from "./quick";

/**
 * The pure rules behind the `?quick=` comma-set and the chip interaction:
 * `parseQuick` (validate + de-dupe + collapse the exclusive safety group),
 * `serializeQuick` (canonical order), and `applyQuickToggle` (the group-aware
 * toggle reducer).
 *
 * The vocabulary is `celiac` + `recent`; `friendly` arrives only from old
 * shared links and must degrade to no filter.
 */

describe("vocabulary", () => {
  it("is exactly the two live tokens — `friendly` is retired (AUB-295)", () => {
    expect(QUICK_FILTER_VALUES).toEqual(["celiac", "recent"]);
  });
});

describe("group model", () => {
  it("maps the safety token to an exclusive group and recency to an additive one", () => {
    // `safety` is a degenerate single-member exclusive group, so a second
    // safety token slots in without re-deriving the rules.
    expect(QUICK_FILTER_GROUPS.celiac).toBe("safety");
    expect(QUICK_FILTER_GROUPS.recent).toBe("recency");
    expect(EXCLUSIVE_QUICK_GROUPS.has("safety")).toBe(true);
    expect(EXCLUSIVE_QUICK_GROUPS.has("recency")).toBe(false);
  });
});

describe("parseQuick", () => {
  it("parses a comma-set of known tokens in canonical order", () => {
    expect(parseQuick("celiac,recent")).toEqual(["celiac", "recent"]);
    // Canonical order is enforced regardless of URL order.
    expect(parseQuick("recent,celiac")).toEqual(["celiac", "recent"]);
  });

  it("de-dupes repeated tokens and trims whitespace", () => {
    expect(parseQuick("celiac,celiac")).toEqual(["celiac"]);
    expect(parseQuick(" celiac , recent ")).toEqual(["celiac", "recent"]);
  });

  it("drops unknown / garbage tokens (graceful degrade, never throws)", () => {
    expect(parseQuick("celiac,bogus")).toEqual(["celiac"]);
    expect(parseQuick("bogus")).toEqual([]);
    expect(parseQuick("")).toEqual([]);
  });

  it("degrades a shared pre-AUB-295 `?quick=friendly` link to no filter", () => {
    // The retired token is now just an unknown token: a link someone bookmarked
    // or posted still loads the directory, unfiltered, instead of erroring or
    // resolving to some other safety reading.
    expect(parseQuick("friendly")).toEqual([]);
    // …and it never suppresses the tokens beside it.
    expect(parseQuick("friendly,recent")).toEqual(["recent"]);
    expect(parseQuick("celiac,friendly")).toEqual(["celiac"]);
    expect(parseQuick("friendly,celiac,recent")).toEqual(["celiac", "recent"]);
  });

  it("collapses the exclusive safety group to ONE member, deterministically by vocab order", () => {
    // Degenerate today (one safety token), but the rule still holds: repeated
    // members of an exclusive group never AND to an empty result.
    expect(parseQuick("celiac,celiac,recent")).toEqual(["celiac", "recent"]);
    expect(parseQuick("recent,celiac,celiac")).toEqual(["celiac", "recent"]);
  });
});

describe("serializeQuick", () => {
  it("joins in canonical order, regardless of input order", () => {
    expect(serializeQuick(["recent", "celiac"])).toBe("celiac,recent");
    expect(serializeQuick(["celiac"])).toBe("celiac");
  });

  it("serializes an empty selection to '' (stripped from the URL)", () => {
    expect(serializeQuick([])).toBe("");
  });

  it("round-trips with parseQuick", () => {
    expect(parseQuick(serializeQuick(["recent", "celiac"]))).toEqual(["celiac", "recent"]);
    expect(parseQuick(serializeQuick(["recent"]))).toEqual(["recent"]);
  });
});

describe("applyQuickToggle", () => {
  it("adds a token to an empty selection", () => {
    expect(applyQuickToggle([], "celiac")).toEqual(["celiac"]);
  });

  it("re-selecting the only safety member is idempotent (radio behavior, one member)", () => {
    // The exclusive-group replace path: selecting `celiac` clears any sibling
    // in `safety` first. With a single member that means it stays selected once
    // and never duplicates, and the additive recency selection is untouched.
    expect(applyQuickToggle([], "celiac")).toEqual(["celiac"]);
    expect(applyQuickToggle(["recent"], "celiac")).toEqual(["celiac", "recent"]);
  });

  it("adds an additive (recency) token alongside a safety choice", () => {
    expect(applyQuickToggle(["celiac"], "recent")).toEqual(["celiac", "recent"]);
  });

  it("toggles an already-selected token off", () => {
    expect(applyQuickToggle(["celiac"], "celiac")).toEqual([]);
    expect(applyQuickToggle(["celiac", "recent"], "recent")).toEqual(["celiac"]);
  });

  it("always returns a canonically-ordered selection", () => {
    // Toggle recent on first, then a safety choice — result is still vocab-ordered.
    expect(applyQuickToggle(["recent"], "celiac")).toEqual(["celiac", "recent"]);
  });
});
