import { describe, expect, it } from "vitest";
import { claims, listingLinks, listings, users } from "~/db/schema";
import { type SeedListingsResult, seedListings } from "./seed";
import { CURATOR_BOT, type SeededListing } from "./seed-data";

/**
 * Tests for the listings seeder core (AUB-31). The core is API-free: it takes its
 * DB as an injected dep (per `docs/agents/testing.md`) and already-resolved BAKED
 * `SeededListing[]` data as an argument, so we model the exact drizzle chains it
 * uses — insert().values().onConflictDoNothing([.returning()]) and
 * select().from().where().limit() — with a small fake, and assert behaviour without
 * a live DB or network.
 */

type Rows = { id: string }[];

interface FakeState {
  botRows: Rows;
  /** FIFO of `.returning()` results for each `insert(listings)` in call order. */
  listingReturning: Rows[];
  /** FIFO of `select(listings)…limit()` results (the dedup read-back). */
  listingSelect: Rows[];
  /** `.returning()` result for every `insert(claims)`. */
  claimReturning: Rows;
  /** `.returning()` result for every `insert(listingLinks)` (AUB-220). */
  linkReturning: Rows;
}

function makeFakeDb(overrides: Partial<FakeState> = {}) {
  const state: FakeState = {
    botRows: [{ id: "bot-1" }],
    listingReturning: [],
    listingSelect: [],
    claimReturning: [{ id: "claim-1" }],
    linkReturning: [{ id: "link-1" }],
    ...overrides,
  };
  const inserts: Array<{ table: unknown; values: unknown }> = [];

  const thenableWithReturning = (rows: () => Rows) => {
    const p = Promise.resolve(undefined) as Promise<undefined> & {
      returning: () => Promise<Rows>;
    };
    p.returning = () => Promise.resolve(rows());
    return p;
  };

  const db = {
    insert(table: unknown) {
      return {
        values(values: unknown) {
          inserts.push({ table, values });
          return {
            onConflictDoNothing() {
              if (table === listings) {
                return thenableWithReturning(() => state.listingReturning.shift() ?? []);
              }
              if (table === claims) {
                return thenableWithReturning(() => state.claimReturning);
              }
              if (table === listingLinks) {
                return thenableWithReturning(() => state.linkReturning);
              }
              // users: awaited WITHOUT `.returning()` — a plain resolved thenable.
              return thenableWithReturning(() => []);
            },
          };
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              return {
                limit() {
                  if (table === users) return Promise.resolve(state.botRows);
                  if (table === listings) return Promise.resolve(state.listingSelect.shift() ?? []);
                  return Promise.resolve([] as Rows);
                },
              };
            },
          };
        },
      };
    },
  };

  // The core only uses this narrow surface; cast through unknown (test-only).
  return { db: db as unknown as Parameters<typeof seedListings>[1]["db"], inserts, state };
}

const listing = (over: Partial<SeededListing> = {}): SeededListing => ({
  placeId: "place-1",
  name: "Moore Cafe and Bakery",
  address: "123 Main St, Denver, CO",
  lat: 39.75,
  lng: -104.99,
  suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
  menuUrl: null,
  googleRating: 4.8,
  googleRatingCount: 120,
  ...over,
});

describe("seedListings", () => {
  it("upserts the curator bot and suggests each label under it for a baked listing", async () => {
    const { db, inserts } = makeFakeDb({ listingReturning: [[{ id: "listing-1" }]] });

    const result: SeedListingsResult = await seedListings([listing()], { db });

    expect(result.botUserId).toBe("bot-1");
    expect(result.listingsInserted).toBe(1);
    expect(result.listingsExisting).toBe(0);
    expect(result.claimsSuggested).toBe(2);
    expect(result.skipped).toEqual([]);

    // The bot is upserted with the sentinel identity (never a real Google sub).
    const botInsert = inserts.find((i) => i.table === users);
    expect(botInsert?.values).toMatchObject({
      googleSub: CURATOR_BOT.googleSub,
      email: CURATOR_BOT.email,
      name: CURATOR_BOT.name,
    });

    // Every claim is suggested by the bot, on the resolved listing, per attribute.
    const claimInserts = inserts.filter((i) => i.table === claims);
    expect(claimInserts).toHaveLength(2);
    expect(claimInserts.map((c) => c.values)).toEqual([
      { listingId: "listing-1", attribute: "dedicated_fryer", suggestedBy: "bot-1" },
      { listingId: "listing-1", attribute: "gf_substitutes", suggestedBy: "bot-1" },
    ]);

    // The listing persists a documented Maps URLs API deep-link + the baked fields.
    const listingInsert = inserts.find((i) => i.table === listings);
    expect(listingInsert?.values).toMatchObject({
      placeId: "place-1",
      name: "Moore Cafe and Bakery",
      mapsUrl:
        "https://www.google.com/maps/search/?api=1&query=Moore%20Cafe%20and%20Bakery%20123%20Main%20St%2C%20Denver%2C%20CO&query_place_id=place-1",
    });
    // The legacy menu_url column is NEVER written post-AUB-202 (AUB-220): the
    // key must be absent from the insert values entirely, not just null.
    expect(Object.keys(listingInsert?.values as object)).not.toContain("menuUrl");
  });

  it("prefers a baked googleMapsUri (Google's share link) as the persisted mapsUrl", async () => {
    const { db, inserts } = makeFakeDb({ listingReturning: [[{ id: "listing-1" }]] });

    await seedListings([listing({ googleMapsUri: "https://maps.google.com/?cid=42" })], { db });

    const listingInsert = inserts.find((i) => i.table === listings);
    expect(listingInsert?.values).toMatchObject({
      mapsUrl: "https://maps.google.com/?cid=42",
    });
  });

  it("falls back to the built link when a baked googleMapsUri is not https", async () => {
    const { db, inserts } = makeFakeDb({ listingReturning: [[{ id: "listing-1" }]] });

    await seedListings([listing({ googleMapsUri: "javascript:alert(1)" })], { db });

    const listingInsert = inserts.find((i) => i.table === listings);
    expect(listingInsert?.values).toMatchObject({
      mapsUrl: expect.stringContaining("https://www.google.com/maps/search/?api=1&query="),
    });
  });

  it("treats a Place-ID dedup hit as an existing no-op and suggests onto the existing listing", async () => {
    // Listing insert conflicts (returns []), so the id is read back via select.
    const { db, inserts } = makeFakeDb({
      listingReturning: [[]],
      listingSelect: [[{ id: "existing-1" }]],
    });

    const result = await seedListings([listing({ suggestedAttributes: ["dedicated_gf_menu"] })], {
      db,
    });

    expect(result.listingsInserted).toBe(0);
    expect(result.listingsExisting).toBe(1);
    const claimInsert = inserts.find((i) => i.table === claims);
    expect(claimInsert?.values).toMatchObject({
      listingId: "existing-1",
      attribute: "dedicated_gf_menu",
    });
  });

  it("does not re-suggest a claim that already exists (idempotent re-run)", async () => {
    // Claim insert conflicts (returns []) — an already-present/attested slot.
    const { db } = makeFakeDb({
      listingReturning: [[{ id: "listing-1" }]],
      claimReturning: [],
    });

    const result = await seedListings([listing({ suggestedAttributes: ["dedicated_fryer"] })], {
      db,
    });

    expect(result.claimsSuggested).toBe(0);
  });

  it("throws when the curator bot row can't be resolved", async () => {
    const { db } = makeFakeDb({ botRows: [] });

    await expect(seedListings([listing()], { db })).rejects.toThrow(/curator bot/i);
  });
});

describe("seedListings — typed menu links (AUB-220)", () => {
  it("seeds an entry's menuUrl as a menu-kind listing_links row (createdBy null) on insert", async () => {
    const { db, inserts } = makeFakeDb({ listingReturning: [[{ id: "listing-1" }]] });

    const result = await seedListings([listing({ menuUrl: "https://spot.example/menu" })], { db });

    expect(result.menuLinksSeeded).toBe(1);
    const linkInsert = inserts.find((i) => i.table === listingLinks);
    expect(linkInsert?.values).toEqual({
      listingId: "listing-1",
      kind: "menu",
      url: "https://spot.example/menu",
      createdBy: null,
    });
  });

  it("does NOT seed a menu link onto an existing (dedup-hit) listing — a user-removed link must never resurrect", async () => {
    // The (listing, kind) slot may be EMPTY because a user deleted their menu
    // link; onConflictDoNothing cannot guard an absent row, so the seed skips
    // existing listings entirely (mirrors the retired backfill's semantics).
    const { db, inserts } = makeFakeDb({
      listingReturning: [[]],
      listingSelect: [[{ id: "existing-1" }]],
    });

    const result = await seedListings([listing({ menuUrl: "https://spot.example/menu" })], { db });

    expect(result.menuLinksSeeded).toBe(0);
    expect(inserts.find((i) => i.table === listingLinks)).toBeUndefined();
  });

  it("never copies a non-http(s) baked menuUrl into the typed table (#90)", async () => {
    const { db, inserts } = makeFakeDb({ listingReturning: [[{ id: "listing-1" }]] });

    const result = await seedListings([listing({ menuUrl: "javascript:alert(1)" })], { db });

    expect(result.menuLinksSeeded).toBe(0);
    expect(inserts.find((i) => i.table === listingLinks)).toBeUndefined();
  });

  it("seeds no link when the entry has no menuUrl", async () => {
    const { db, inserts } = makeFakeDb({ listingReturning: [[{ id: "listing-1" }]] });

    const result = await seedListings([listing({ menuUrl: null })], { db });

    expect(result.menuLinksSeeded).toBe(0);
    expect(inserts.find((i) => i.table === listingLinks)).toBeUndefined();
  });

  it("counts a conflicting link insert as not seeded (defensive onConflictDoNothing)", async () => {
    const { db } = makeFakeDb({
      listingReturning: [[{ id: "listing-1" }]],
      linkReturning: [],
    });

    const result = await seedListings([listing({ menuUrl: "https://spot.example/menu" })], { db });

    expect(result.menuLinksSeeded).toBe(0);
  });
});
