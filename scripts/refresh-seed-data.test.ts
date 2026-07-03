import { describe, expect, it, vi } from "vitest";
import { type ResolvedPlace, refreshSeedData, runCli } from "./refresh-seed-data";
import type { SeedSource } from "./seed-sources";

/**
 * Tests for the seed-data refresh core (AUB-31). The core takes its sources + a
 * Places resolver as injected deps, so we exercise it with a mocked resolver — no
 * live network — and assert it bakes resolved sources into `SeededListing`s and
 * records the ones the resolver can't place.
 */

const place = (over: Partial<ResolvedPlace> = {}): ResolvedPlace => ({
  placeId: "place-1",
  name: "Moore Cafe and Bakery",
  address: "123 Main St, Denver, CO",
  lat: 39.75,
  lng: -104.99,
  googleRating: 4.8,
  googleRatingCount: 120,
  googleMapsUri: "https://maps.google.com/?cid=98765",
  ...over,
});

const source = (over: Partial<SeedSource> = {}): SeedSource => ({
  query: "Moore Cafe and Bakery, Denver, CO",
  suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
  menuUrl: "https://example.com/menu",
  ...over,
});

describe("refreshSeedData", () => {
  it("bakes a resolved source into a SeededListing carrying the captured fields", async () => {
    const resolvePlace = vi.fn(async () => place());

    const result = await refreshSeedData({ sources: [source()], resolvePlace });

    expect(result.skipped).toEqual([]);
    expect(result.listings).toEqual([
      {
        placeId: "place-1",
        name: "Moore Cafe and Bakery",
        address: "123 Main St, Denver, CO",
        lat: 39.75,
        lng: -104.99,
        suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
        menuUrl: "https://example.com/menu",
        googleRating: 4.8,
        googleRatingCount: 120,
        googleMapsUri: "https://maps.google.com/?cid=98765",
      },
    ]);
  });

  it("records a source the resolver can't place, without baking a listing", async () => {
    const resolvePlace = vi.fn(async () => null);

    const result = await refreshSeedData({ sources: [source()], resolvePlace });

    expect(result.listings).toEqual([]);
    expect(result.skipped).toEqual([
      { query: "Moore Cafe and Bakery, Denver, CO", reason: "unresolved-or-out-of-range" },
    ]);
  });

  it("defaults a missing menuUrl, rating, and maps link to null on the baked entry", async () => {
    // A resolver + source that omit the optional fields entirely.
    const bareResolved: ResolvedPlace = {
      placeId: "place-1",
      name: "Moore Cafe and Bakery",
      address: "123 Main St, Denver, CO",
      lat: 39.75,
      lng: -104.99,
    };
    const bareSource: SeedSource = {
      query: "Moore Cafe and Bakery, Denver, CO",
      suggestedAttributes: ["dedicated_fryer"],
    };
    const resolvePlace = vi.fn(async () => bareResolved);

    const result = await refreshSeedData({ sources: [bareSource], resolvePlace });

    expect(result.listings[0]).toMatchObject({
      menuUrl: null,
      googleRating: null,
      googleRatingCount: null,
      googleMapsUri: null,
    });
  });
});

describe("runCli", () => {
  it("refuses to overwrite the bake (exit 1, no write) when every source fails to resolve", async () => {
    // A resolver that returns null for everything simulates a bad/expired/quota'd
    // key: the guard must fail loudly BEFORE writeFileSync, so a green refresh can
    // never wipe the committed seed data to `[]`.
    const resolvePlace = vi.fn(async () => null);
    const error = vi.fn();

    const code = await runCli(
      { sources: [source(), source({ query: "Second" })], resolvePlace },
      { log: vi.fn(), error }
    );

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("refusing to overwrite"));
  });
});
