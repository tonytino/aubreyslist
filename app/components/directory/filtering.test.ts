import { describe, expect, it } from "vitest";
import type { RestaurantCardVM } from "~/components/listing/ListingCard";
import { filterByQuick } from "./filtering";

/**
 * Tests for the directory's pure client-side quick-chip filtering (AUB-61,
 * Phase 2b). Free-text search is SERVER-side (`?q=`), so it is NOT covered here;
 * this covers only the quick chips, which filter by DERIVED trust state over the
 * current server result set. This logic is safety-relevant (a wrong filter could
 * hide a warning or surface a mismatch), so it is unit-tested directly.
 */

function vm(overrides: Partial<RestaurantCardVM>): RestaurantCardVM {
  return {
    id: "id",
    name: "Name",
    address: "Address",
    safetyState: null,
    hasRecentIncident: false,
    accent: "lavender",
    ...overrides,
  };
}

const cards: RestaurantCardVM[] = [
  vm({ id: "a", name: "Root & Rye", address: "12 RiNo Ave", safetyState: "celiac-safe" }),
  vm({
    id: "b",
    name: "Ombré Thai",
    address: "5 Capitol Hill Rd",
    safetyState: "gluten-friendly",
  }),
  vm({
    id: "c",
    name: "Copper Fork",
    address: "9 Cherry Creek",
    safetyState: "stale",
    freshness: { kind: "stale", label: "Updated 4mo ago" },
  }),
  vm({
    id: "d",
    name: "Wax & Wane",
    address: "3 Five Points",
    safetyState: "celiac-safe",
    freshness: { kind: "fresh", label: "Verified 2d ago" },
  }),
];

describe("filterByQuick", () => {
  it("returns the set unchanged when no quick chip is active", () => {
    expect(filterByQuick(cards, null)).toHaveLength(4);
  });

  it("celiac keeps only celiac-safe cards", () => {
    const result = filterByQuick(cards, "celiac");
    expect(result.map((c) => c.id).sort()).toEqual(["a", "d"]);
  });

  it("friendly keeps only gluten-friendly cards", () => {
    const result = filterByQuick(cards, "friendly");
    expect(result.map((c) => c.id)).toEqual(["b"]);
  });

  it("recent keeps only cards whose freshness is fresh", () => {
    const result = filterByQuick(cards, "recent");
    expect(result.map((c) => c.id)).toEqual(["d"]);
  });
});
