import { describe, expect, it } from "vitest";
import {
  EXCLUSIVE_QUICK_GROUPS,
  QUICK_FILTER_GROUPS,
  applyQuickToggle,
  parseQuick,
  serializeQuick,
} from "./quick";

/**
 * Unit tests for the faceted quick-filter selection helpers (AUB-140). These are
 * the pure rules behind the URL comma-set (`?quick=`) and the chip interaction:
 * `parseQuick` (validate + de-dupe + collapse the mutually-exclusive safety group),
 * `serializeQuick` (canonical order), and `applyQuickToggle` (the group-aware toggle
 * reducer). The SQL side is `quick-filter.test.ts`; the route only wires these.
 */

describe("group model", () => {
  it("maps the safety pair to an exclusive group and recency to an additive one", () => {
    expect(QUICK_FILTER_GROUPS.celiac).toBe("safety");
    expect(QUICK_FILTER_GROUPS.friendly).toBe("safety");
    expect(QUICK_FILTER_GROUPS.recent).toBe("recency");
    expect(EXCLUSIVE_QUICK_GROUPS.has("safety")).toBe(true);
    expect(EXCLUSIVE_QUICK_GROUPS.has("recency")).toBe(false);
  });
});

describe("parseQuick", () => {
  it("parses a comma-set of known tokens in canonical order", () => {
    expect(parseQuick("celiac,recent")).toEqual(["celiac", "recent"]);
    // Canonical order is enforced regardless of URL order.
    expect(parseQuick("recent,friendly")).toEqual(["friendly", "recent"]);
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

  it("collapses the exclusive safety group to ONE member, deterministically by vocab order", () => {
    // Both URL orders resolve to the same survivor (celiac, first in vocab order) —
    // so a hand-typed / stale `?quick=celiac,friendly` never ANDs to an empty result.
    expect(parseQuick("celiac,friendly")).toEqual(["celiac"]);
    expect(parseQuick("friendly,celiac")).toEqual(["celiac"]);
    // The additive recency member survives alongside the collapsed safety winner.
    expect(parseQuick("friendly,celiac,recent")).toEqual(["celiac", "recent"]);
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
    expect(parseQuick(serializeQuick(["recent", "friendly"]))).toEqual(["friendly", "recent"]);
  });
});

describe("applyQuickToggle", () => {
  it("adds a token to an empty selection", () => {
    expect(applyQuickToggle([], "celiac")).toEqual(["celiac"]);
  });

  it("replaces the sibling within the exclusive safety group (radio behavior)", () => {
    expect(applyQuickToggle(["celiac"], "friendly")).toEqual(["friendly"]);
    // Replacing the safety choice leaves an additive recency selection intact.
    expect(applyQuickToggle(["celiac", "recent"], "friendly")).toEqual(["friendly", "recent"]);
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
