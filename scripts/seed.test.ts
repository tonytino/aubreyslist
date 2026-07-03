import { describe, expect, it } from "vitest";
import { claims, listings, users } from "~/db/schema";
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
}

function makeFakeDb(overrides: Partial<FakeState> = {}) {
  const state: FakeState = {
    botRows: [{ id: "bot-1" }],
    listingReturning: [],
    listingSelect: [],
    claimReturning: [{ id: "claim-1" }],
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
