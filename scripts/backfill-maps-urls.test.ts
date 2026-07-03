import { describe, expect, it } from "vitest";
import { listings } from "~/db/schema";
import {
  type BackfillMapsUrlsResult,
  LEGACY_MAPS_URL_PREFIX,
  backfillMapsUrls,
} from "./backfill-maps-urls";

/**
 * Tests for the maps-URL backfill core. Like the seeder tests, the core is
 * API-free with an injected DB (per `docs/agents/testing.md`), so we model the
 * exact drizzle chains it uses — select().from().where() and
 * update().set().where() — with a small fake and assert behaviour without a
 * live DB or network.
 */

interface LegacyRow {
  id: string;
  placeId: string | null;
  name: string;
  address: string;
}

function makeFakeDb(legacyRows: LegacyRow[]) {
  const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];

  const db = {
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              return Promise.resolve(table === listings ? legacyRows : []);
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          updates.push({ table, set: values });
          return { where: () => Promise.resolve(undefined) };
        },
      };
    },
  };

  // The core only uses this narrow surface; cast through unknown (test-only).
  return { db: db as unknown as Parameters<typeof backfillMapsUrls>[0]["db"], updates };
}

const legacy = (over: Partial<LegacyRow> = {}): LegacyRow => ({
  id: "listing-1",
  placeId: "ChIJ_abc",
  name: "Aubrey's Cafe",
  address: "123 Main St, Denver, CO",
  ...over,
});

describe("backfillMapsUrls", () => {
  it("rewrites a legacy row to the documented Maps URLs API format from its own columns", async () => {
    const { db, updates } = makeFakeDb([legacy()]);

    const result: BackfillMapsUrlsResult = await backfillMapsUrls({ db });

    expect(result).toEqual({ updated: 1, skippedNoPlaceId: 0 });
    expect(updates).toHaveLength(1);
    expect(updates[0]?.table).toBe(listings);
    expect(updates[0]?.set.mapsUrl).toBe(
      "https://www.google.com/maps/search/?api=1&query=Aubrey's%20Cafe%20123%20Main%20St%2C%20Denver%2C%20CO&query_place_id=ChIJ_abc"
    );
    // The rewritten URL can never match the legacy prefix again (idempotency).
    expect(String(updates[0]?.set.mapsUrl)).not.toContain(LEGACY_MAPS_URL_PREFIX);
  });

  it("skips (and reports) a legacy row with no Place ID rather than guessing", async () => {
    const logs: string[] = [];
    const { db, updates } = makeFakeDb([legacy({ placeId: null })]);

    const result = await backfillMapsUrls({ db, log: (m) => logs.push(m) });

    expect(result).toEqual({ updated: 0, skippedNoPlaceId: 1 });
    expect(updates).toHaveLength(0);
    expect(logs.join("\n")).toContain("no Place ID");
  });

  it("is a no-op when nothing matches the legacy prefix", async () => {
    const { db, updates } = makeFakeDb([]);

    const result = await backfillMapsUrls({ db });

    expect(result).toEqual({ updated: 0, skippedNoPlaceId: 0 });
    expect(updates).toHaveLength(0);
  });

  it("processes every matching row independently (mixed batch)", async () => {
    const { db, updates } = makeFakeDb([
      legacy({ id: "l-1", placeId: "p-1", name: "One", address: "A St" }),
      legacy({ id: "l-2", placeId: null }),
      legacy({ id: "l-3", placeId: "p-3", name: "Three", address: "C St" }),
    ]);

    const result = await backfillMapsUrls({ db });

    expect(result).toEqual({ updated: 2, skippedNoPlaceId: 1 });
    expect(updates.map((u) => u.set.mapsUrl)).toEqual([
      "https://www.google.com/maps/search/?api=1&query=One%20A%20St&query_place_id=p-1",
      "https://www.google.com/maps/search/?api=1&query=Three%20C%20St&query_place_id=p-3",
    ]);
  });
});
