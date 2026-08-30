import { describe, expect, it, vi } from "vitest";
import { brandOf, expandChainLocations, matchesBrand, runCli } from "./expand-chain-locations";
import type { ResolvedPlace } from "./refresh-seed-data";
import type { SeededListing } from "./seed-data";
import { SEED_SOURCES, type SeedSource } from "./seed-sources";

/**
 * Tests for the chain fan-out core. Sources, the curated bake, and the Places
 * resolver are injected, so a mocked resolver exercises everything with no
 * live network: inheritance of ONLY the chain-wide attributes, dedup against
 * the curated bake and across brands, the 50-mile cap, and the fail-loud
 * guards for miscurated sources and implausibly empty runs.
 */

const place = (over: Partial<ResolvedPlace> = {}): ResolvedPlace => ({
  placeId: "place-2",
  name: "Five Guys",
  address: "2021 S Colorado Blvd, Denver, CO",
  lat: 39.68,
  lng: -104.94,
  googleMapsUri: "https://maps.google.com/?cid=12345",
  ...over,
});

const chainSource = (over: Partial<SeedSource> = {}): SeedSource => ({
  query: "Five Guys, Denver, CO",
  suggestedAttributes: ["dedicated_fryer"],
  menuUrl: "https://www.fiveguys.com/",
  chain: true,
  chainWideAttributes: ["dedicated_fryer"],
  ...over,
});

/** A miscurated source: chainWideAttributes without the chain flag. */
const chainlessSource = (): SeedSource => ({
  query: "Five Guys, Denver, CO",
  suggestedAttributes: ["dedicated_fryer"],
  chainWideAttributes: ["dedicated_fryer"],
});

const curated = (over: Partial<SeededListing> = {}): SeededListing => ({
  placeId: "place-1",
  name: "Five Guys",
  address: "1 Flagship Way, Denver, CO",
  lat: 39.75,
  lng: -104.99,
  suggestedAttributes: ["dedicated_fryer"],
  menuUrl: "https://www.fiveguys.com/",
  googleMapsUri: null,
  ...over,
});

describe("brandOf", () => {
  it("takes the query up to the first comma", () => {
    expect(brandOf(chainSource())).toBe("Five Guys");
    expect(brandOf(chainSource({ query: "P.F. Chang's, Cherry Creek, Denver, CO" }))).toBe(
      "P.F. Chang's"
    );
  });
});

describe("matchesBrand", () => {
  it("matches across punctuation and the ampersand/and spelling split", () => {
    expect(matchesBrand("P.F. Chang's", "PF Changs China Bistro")).toBe(true);
    expect(matchesBrand("Lazy Dog Restaurant and Bar", "Lazy Dog Restaurant & Bar")).toBe(true);
    expect(matchesBrand("Five Guys", "Five Gals Burger Bar")).toBe(false);
  });
});

describe("expandChainLocations", () => {
  it("emits an in-range location with ONLY the chain-wide attributes", async () => {
    const source = chainSource({
      suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
      chainWideAttributes: ["dedicated_fryer"],
    });
    const resolveLocations = vi.fn(async () => [place()]);

    const result = await expandChainLocations({
      sources: [source],
      curatedListings: [curated()],
      resolveLocations,
    });

    expect(resolveLocations).toHaveBeenCalledWith("Five Guys");
    expect(result.listings).toEqual([
      {
        placeId: "place-2",
        name: "Five Guys",
        address: "2021 S Colorado Blvd, Denver, CO",
        lat: 39.68,
        lng: -104.94,
        suggestedAttributes: ["dedicated_fryer"],
        // Never the flagship's menuUrl — it is often a location-specific page.
        menuUrl: null,
        googleMapsUri: "https://maps.google.com/?cid=12345",
      },
    ]);
  });

  it("drops results whose name does not match the brand, and logs the mismatch", async () => {
    const log = vi.fn();
    const lookalike = place({ placeId: "impostor", name: "Five Gals Burger Bar" });
    const branded = place({ placeId: "real", name: "Five Guys Burgers and Fries" });
    const resolveLocations = vi.fn(async () => [lookalike, branded]);

    const result = await expandChainLocations({
      sources: [chainSource()],
      curatedListings: [],
      resolveLocations,
      log,
    });

    expect(result.listings.map((entry) => entry.placeId)).toEqual(["real"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("NAME-MISMATCH"));
  });

  it("ignores sources without chainWideAttributes — they do not fan out", async () => {
    const resolveLocations = vi.fn(async () => [place()]);

    const result = await expandChainLocations({
      sources: [
        {
          query: "Fryerless Chain, Denver, CO",
          suggestedAttributes: ["gf_substitutes"],
          chain: true,
        },
        { query: "Solo Cafe, Denver, CO", suggestedAttributes: ["gf_substitutes"] },
      ],
      curatedListings: [],
      resolveLocations,
    });

    expect(resolveLocations).not.toHaveBeenCalled();
    expect(result.listings).toEqual([]);
  });

  it("dedups against the curated bake (the flagship never re-emits) and across brands", async () => {
    const flagship = place({ placeId: "place-1" });
    const shared = place({ placeId: "place-2" });
    const resolveLocations = vi.fn(async () => [flagship, shared]);

    const result = await expandChainLocations({
      sources: [chainSource(), chainSource({ query: "Five Guys Too, Denver, CO" })],
      curatedListings: [curated()],
      resolveLocations,
    });

    // place-1 is the curated flagship; place-2 emits once despite both brands
    // resolving it.
    expect(result.listings.map((entry) => entry.placeId)).toEqual(["place-2"]);
  });

  it("drops locations beyond the 50-mile cap and logs them", async () => {
    const log = vi.fn();
    const coloradoSprings = place({ placeId: "far", lat: 38.83, lng: -104.82 });
    const resolveLocations = vi.fn(async () => [coloradoSprings]);

    const result = await expandChainLocations({
      sources: [chainSource()],
      curatedListings: [],
      resolveLocations,
      log,
    });

    expect(result.listings).toEqual([]);
    expect(result.skipped).toEqual([
      { query: "Five Guys, Denver, CO", reason: "no-new-in-range-locations" },
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("OUT-OF-RANGE"));
  });

  it("throws on chainWideAttributes without chain: true", async () => {
    await expect(
      expandChainLocations({
        sources: [chainlessSource()],
        curatedListings: [],
        resolveLocations: vi.fn(async () => []),
      })
    ).rejects.toThrow(/no chain: true/);
  });

  it("throws when chainWideAttributes is not a subset of suggestedAttributes", async () => {
    await expect(
      expandChainLocations({
        sources: [
          chainSource({
            suggestedAttributes: ["dedicated_fryer"],
            chainWideAttributes: ["dedicated_gf_menu"],
          }),
        ],
        curatedListings: [],
        resolveLocations: vi.fn(async () => []),
      })
    ).rejects.toThrow(/not in suggestedAttributes/);
  });

  it("throws on an empty chainWideAttributes", async () => {
    await expect(
      expandChainLocations({
        sources: [chainSource({ chainWideAttributes: [] })],
        curatedListings: [],
        resolveLocations: vi.fn(async () => []),
      })
    ).rejects.toThrow(/empty chainWideAttributes/);
  });
});

describe("SEED_SOURCES chain curation", () => {
  it("every chainWideAttributes in the real curated data passes the fan-out invariants", async () => {
    // The core validates as it walks; a resolver returning nothing makes this a
    // pure validation pass over the committed curation.
    await expect(
      expandChainLocations({
        sources: SEED_SOURCES,
        curatedListings: [],
        resolveLocations: async () => [],
      })
    ).resolves.toBeTruthy();
  });
});

describe("runCli", () => {
  it("refuses to overwrite the bake (exit 1, no write) when every brand resolves nothing", async () => {
    const error = vi.fn();

    const code = await runCli(
      {
        sources: [chainSource()],
        curatedListings: [],
        resolveLocations: vi.fn(async () => []),
      },
      { log: vi.fn(), error }
    );

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("refusing to overwrite"));
  });

  it("surfaces a resolver failure as exit 1 (no write) instead of an empty brand", async () => {
    const error = vi.fn();

    const code = await runCli(
      {
        sources: [chainSource()],
        curatedListings: [],
        resolveLocations: vi.fn(async () => {
          throw new Error('Places searchText 429 for "Five Guys"');
        }),
      },
      { log: vi.fn(), error }
    );

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("429"));
  });

  it("surfaces a miscurated source as exit 1", async () => {
    const error = vi.fn();

    const code = await runCli(
      {
        sources: [chainlessSource()],
        curatedListings: [],
        resolveLocations: vi.fn(async () => []),
      },
      { log: vi.fn(), error }
    );

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("no chain: true"));
  });
});
