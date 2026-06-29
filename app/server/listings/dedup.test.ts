import { describe, expect, it } from "vitest";
import type { Listing } from "~/db/schema";
import {
  DuplicateListingError,
  findDuplicateListing,
  normalizeForDedup,
  parseDuplicateListingError,
} from "./dedup";

/**
 * Unit tests for the manual-entry duplicate safeguard (issue #25). These exercise
 * the pure normalization + matching rule in isolation (no DB); `create.test.ts`
 * covers how `runCreateListing` wires it into the manual intake path.
 */

function listingRow(overrides: Partial<Listing> = {}): Listing {
  return {
    id: "listing-1",
    placeId: null,
    name: "Corner Cafe",
    address: "1 Main St, Denver, CO",
    lat: 39.7,
    lng: -104.9,
    mapsUrl: "https://maps.example/1",
    menuUrl: null,
    moderationStatus: "visible",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Listing;
}

describe("normalizeForDedup", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeForDedup("  Corner   Cafe  ")).toBe("corner cafe");
  });

  it("lowercases", () => {
    expect(normalizeForDedup("CORNER Cafe")).toBe("corner cafe");
  });

  it("folds diacritics (NFKD)", () => {
    expect(normalizeForDedup("Café Peña")).toBe("cafe pena");
  });

  it("collapses punctuation/symbols to a single separator", () => {
    // Each run of non-alphanumerics becomes exactly one space (and trims edges).
    expect(normalizeForDedup("Joe's Diner #2")).toBe("joe s diner 2");
    expect(normalizeForDedup("1 Main St., Denver, CO")).toBe(
      normalizeForDedup("1 Main St   Denver  CO")
    );
    expect(normalizeForDedup("1 Main St., Denver, CO")).toBe("1 main st denver co");
  });

  it("treats '&' and 'and'-style symbols as separators (not letters)", () => {
    expect(normalizeForDedup("Salt & Straw")).toBe("salt straw");
  });

  it("returns empty string for punctuation-only / blank input", () => {
    expect(normalizeForDedup("   ")).toBe("");
    expect(normalizeForDedup("--,. ")).toBe("");
  });
});

describe("findDuplicateListing", () => {
  const candidate = { name: "Corner Cafe", address: "1 Main St, Denver, CO" };

  it("matches an exact existing listing", () => {
    const existing = listingRow();
    expect(findDuplicateListing(candidate, [existing])).toBe(existing);
  });

  it("matches across case / whitespace / punctuation / accent differences", () => {
    const existing = listingRow({
      id: "dup-1",
      name: "  CÓRNER  café ",
      address: "1 main st., denver co",
    });
    const result = findDuplicateListing({ name: "Corner Cafe", address: "1 Main St Denver CO" }, [
      existing,
    ]);
    expect(result).toBe(existing);
  });

  it("does NOT match when the name differs", () => {
    const existing = listingRow({ name: "Different Diner" });
    expect(findDuplicateListing(candidate, [existing])).toBeNull();
  });

  it("does NOT match when the address differs (e.g. two chain branches)", () => {
    const existing = listingRow({ address: "999 Other Ave, Boulder, CO" });
    expect(findDuplicateListing(candidate, [existing])).toBeNull();
  });

  it("does NOT false-positive on clearly different places", () => {
    const existing = [
      listingRow({ id: "a", name: "Sweet Action", address: "52 Broadway, Denver" }),
      listingRow({ id: "b", name: "Watercourse Foods", address: "837 E 17th Ave, Denver" }),
    ];
    expect(findDuplicateListing(candidate, existing)).toBeNull();
  });

  it("returns null when candidate name/address normalize to empty", () => {
    expect(findDuplicateListing({ name: "  ", address: "1 Main St" }, [listingRow()])).toBeNull();
    expect(findDuplicateListing({ name: "Corner Cafe", address: " " }, [listingRow()])).toBeNull();
  });

  it("returns the first match when several exist", () => {
    const first = listingRow({ id: "first" });
    const second = listingRow({ id: "second" });
    expect(findDuplicateListing(candidate, [first, second])).toBe(first);
  });
});

describe("DuplicateListingError", () => {
  it("carries the existing listing id and name, with an actionable message", () => {
    const err = new DuplicateListingError({ id: "existing-9", name: "Corner Cafe" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DuplicateListingError");
    expect(err.existingListingId).toBe("existing-9");
    expect(err.existingListingName).toBe("Corner Cafe");
    expect(err.message).toContain("Corner Cafe");
    expect(err.message).toContain("already listed");
  });
});

describe("parseDuplicateListingError", () => {
  it("recovers the existing id and a marker-free message from a thrown error", () => {
    // Models the client side: across the server-fn RPC boundary the error arrives
    // as a plain Error with just the (marker-bearing) message, not the subclass.
    const thrown = new DuplicateListingError({ id: "existing-9", name: "Corner Cafe" });
    const plain = new Error(thrown.message);

    const parsed = parseDuplicateListingError(plain);
    expect(parsed).not.toBeNull();
    expect(parsed?.existingListingId).toBe("existing-9");
    // The machine-readable marker is stripped from what the UI displays.
    expect(parsed?.message).toContain("Corner Cafe");
    expect(parsed?.message).not.toContain("existing-listing:");
    expect(parsed?.message).not.toContain("[[");
  });

  it("returns null for an unrelated error (no marker)", () => {
    expect(parseDuplicateListingError(new Error("Something else went wrong"))).toBeNull();
  });

  it("returns null for non-error / non-string inputs", () => {
    expect(parseDuplicateListingError(undefined)).toBeNull();
    expect(parseDuplicateListingError(null)).toBeNull();
    expect(parseDuplicateListingError({ message: "[[existing-listing:x]]" })).toBeNull();
  });
});
