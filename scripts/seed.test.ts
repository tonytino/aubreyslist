import { describe, expect, it, vi } from "vitest";
import { claims, listings, users } from "~/db/schema";
import { type ResolvedPlace, type SeedListingsResult, seedListings } from "./seed";
import { CURATOR_BOT, type SeedListing } from "./seed-data";

/**
 * Tests for the listings seeder core (AUB-31). The core takes its DB + Places
 * resolver as injected deps (per `docs/agents/testing.md`), so we model the exact
 * drizzle chains it uses — insert().values().onConflictDoNothing([.returning()])
 * and select().from().where().limit() — with a small fake, and assert behaviour
 * without a live DB or network.
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

const place = (over: Partial<ResolvedPlace> = {}): ResolvedPlace => ({
  placeId: "place-1",
  name: "Moore Cafe and Bakery",
  address: "123 Main St, Denver, CO",
  lat: 39.75,
  lng: -104.99,
  ...over,
});

const entry = (over: Partial<SeedListing> = {}): SeedListing => ({
  query: "Moore Cafe and Bakery, Denver, CO",
  suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
  ...over,
});

describe("seedListings", () => {
  it("upserts the curator bot and suggests each label under it for a resolved place", async () => {
    const { db, inserts } = makeFakeDb({ listingReturning: [[{ id: "listing-1" }]] });
    const resolvePlace = vi.fn(async () => place());

    const result: SeedListingsResult = await seedListings([entry()], { db, resolvePlace });

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

    // The listing persists a Place-ID Maps deep-link + the resolved fields.
    const listingInsert = inserts.find((i) => i.table === listings);
    expect(listingInsert?.values).toMatchObject({
      placeId: "place-1",
      name: "Moore Cafe and Bakery",
      mapsUrl: "https://www.google.com/maps/place/?q=place_id:place-1",
    });
  });

  it("treats a Place-ID dedup hit as an existing no-op and suggests onto the existing listing", async () => {
    // Listing insert conflicts (returns []), so the id is read back via select.
    const { db, inserts } = makeFakeDb({
      listingReturning: [[]],
      listingSelect: [[{ id: "existing-1" }]],
    });
    const resolvePlace = vi.fn(async () => place());

    const result = await seedListings([entry({ suggestedAttributes: ["dedicated_gf_menu"] })], {
      db,
      resolvePlace,
    });

    expect(result.listingsInserted).toBe(0);
    expect(result.listingsExisting).toBe(1);
    const claimInsert = inserts.find((i) => i.table === claims);
    expect(claimInsert?.values).toMatchObject({
      listingId: "existing-1",
      attribute: "dedicated_gf_menu",
    });
  });

  it("skips (and records) an entry the resolver can't place, without inserting a listing", async () => {
    const { db, inserts } = makeFakeDb();
    const resolvePlace = vi.fn(async () => null);

    const result = await seedListings([entry()], { db, resolvePlace });

    expect(result.skipped).toEqual([
      { query: "Moore Cafe and Bakery, Denver, CO", reason: "unresolved-or-out-of-range" },
    ]);
    expect(result.listingsInserted).toBe(0);
    expect(inserts.some((i) => i.table === listings)).toBe(false);
  });

  it("does not re-suggest a claim that already exists (idempotent re-run)", async () => {
    // Claim insert conflicts (returns []) — an already-present/attested slot.
    const { db } = makeFakeDb({
      listingReturning: [[{ id: "listing-1" }]],
      claimReturning: [],
    });
    const resolvePlace = vi.fn(async () => place());

    const result = await seedListings([entry({ suggestedAttributes: ["dedicated_fryer"] })], {
      db,
      resolvePlace,
    });

    expect(result.claimsSuggested).toBe(0);
  });

  it("throws when the curator bot row can't be resolved", async () => {
    const { db } = makeFakeDb({ botRows: [] });
    const resolvePlace = vi.fn(async () => place());

    await expect(seedListings([entry()], { db, resolvePlace })).rejects.toThrow(/curator bot/i);
  });
});
