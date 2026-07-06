import { isNotNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listingLinks, listings } from "~/db/schema";
import { type BackfillListingLinksResult, backfillListingLinks } from "./backfill-listing-links";

/**
 * Tests for the listing-links backfill core (AUB-202). Like the maps-URL
 * backfill tests, the core is API-free with an injected DB (per
 * `docs/agents/testing.md`), so we model the exact drizzle chains it uses —
 * select().from().where() and insert().values().onConflictDoNothing().returning()
 * — with a small fake and assert behaviour without a live DB or network.
 */

interface LegacyRow {
  id: string;
  name: string;
  menuUrl: string | null;
}

function makeFakeDb(legacyRows: LegacyRow[], conflictedListingIds: Set<string> = new Set()) {
  const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const conflictTargets: unknown[] = [];
  const selectWheres: unknown[] = [];
  const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];

  const db = {
    select() {
      return {
        from(table: unknown) {
          return {
            where(condition: unknown) {
              selectWheres.push(condition);
              return Promise.resolve(table === listings ? legacyRows : []);
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          inserts.push({ table, values });
          return {
            onConflictDoNothing(args: unknown) {
              conflictTargets.push(args);
              return {
                // Conflict (already-linked listing) ⇒ empty returning.
                returning: () =>
                  Promise.resolve(
                    conflictedListingIds.has(String(values.listingId))
                      ? []
                      : [{ id: `link-${String(values.listingId)}` }]
                  ),
              };
            },
          };
        },
      };
    },
    // The post-migration legacy clear: update(listings).set({menuUrl: null}).where(...)
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
  return {
    db: db as unknown as Parameters<typeof backfillListingLinks>[0]["db"],
    inserts,
    conflictTargets,
    selectWheres,
    updates,
  };
}

const legacy = (over: Partial<LegacyRow> = {}): LegacyRow => ({
  id: "listing-1",
  name: "Aubrey's Cafe",
  menuUrl: "https://aubreys.example/menu",
  ...over,
});

describe("backfillListingLinks", () => {
  it("selects only rows with a non-null legacy menuUrl", async () => {
    const { db, selectWheres } = makeFakeDb([]);

    await backfillListingLinks({ db });

    expect(selectWheres).toEqual([isNotNull(listings.menuUrl)]);
  });

  it("inserts a menu-kind row with createdBy null, then clears the migrated menu_url", async () => {
    const { db, inserts, conflictTargets, updates } = makeFakeDb([legacy()]);

    const result: BackfillListingLinksResult = await backfillListingLinks({ db });

    expect(result).toEqual({ inserted: 1, alreadyLinked: 0, skippedNotHttp: 0 });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.table).toBe(listingLinks);
    expect(inserts[0]?.values).toEqual({
      listingId: "listing-1",
      kind: "menu",
      url: "https://aubreys.example/menu",
      createdBy: null,
    });
    // Idempotency: the conflict target is the (listing, kind) unique columns.
    expect(conflictTargets[0]).toEqual({
      target: [listingLinks.listingId, listingLinks.kind],
    });
    // Typed writes supersede the legacy column: the migrated value is cleared
    // so the detail page's fallback can never resurrect a later-removed link.
    expect(updates).toHaveLength(1);
    expect(updates[0]?.table).toBe(listings);
    expect(updates[0]?.set).toEqual({ menuUrl: null });
  });

  it("clears the legacy column on a conflict no-op too, without overwriting the typed URL", async () => {
    const { db, inserts, updates } = makeFakeDb([legacy()], new Set(["listing-1"]));

    const result = await backfillListingLinks({ db });

    expect(result).toEqual({ inserted: 0, alreadyLinked: 1, skippedNotHttp: 0 });
    // The insert conflicted — the existing (possibly user-edited) typed URL
    // was never touched — but the redundant legacy column is still cleared.
    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.set).toEqual({ menuUrl: null });
  });

  it("skips a non-http(s) legacy value entirely — no insert, no clear (#90)", async () => {
    const logs: string[] = [];
    const { db, inserts, updates } = makeFakeDb([legacy({ menuUrl: "javascript:alert(1)" })]);

    const result = await backfillListingLinks({ db, log: (m) => logs.push(m) });

    expect(result).toEqual({ inserted: 0, alreadyLinked: 0, skippedNotHttp: 1 });
    expect(inserts).toHaveLength(0);
    // A skipped row is left FULLY untouched — its legacy value stays for a
    // human to look at, it just never renders (the sink guard suppresses it).
    expect(updates).toHaveLength(0);
    expect(logs.join("\n")).toContain("not http(s)");
  });

  it("is a no-op when no listing carries a legacy menuUrl", async () => {
    const { db, inserts, updates } = makeFakeDb([]);

    const result = await backfillListingLinks({ db });

    expect(result).toEqual({ inserted: 0, alreadyLinked: 0, skippedNotHttp: 0 });
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("processes every row independently (mixed batch)", async () => {
    const { db, updates } = makeFakeDb(
      [
        legacy({ id: "l-1", name: "One", menuUrl: "https://one.example/menu" }),
        legacy({ id: "l-2", name: "Two", menuUrl: "ftp://two.example/menu" }),
        legacy({ id: "l-3", name: "Three", menuUrl: "http://three.example/menu" }),
        legacy({ id: "l-4", name: "Four", menuUrl: "https://four.example/menu" }),
      ],
      new Set(["l-4"])
    );

    const result = await backfillListingLinks({ db });

    expect(result).toEqual({ inserted: 2, alreadyLinked: 1, skippedNotHttp: 1 });
    // Cleared for the two inserts + the conflict; never for the ftp skip.
    expect(updates).toHaveLength(3);
  });
});
