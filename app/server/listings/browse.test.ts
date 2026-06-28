import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the browse-list loader (#33, extended for sort/search in #36).
 *
 * `getBrowseListings` issues a FIXED number of batched queries (page of
 * listings joined to a per-listing celiac-trust subquery for ordering, a total
 * count under the same search predicate, one grouped celiac-aggregate query,
 * one incidents query) — no N+1. We model the distinct drizzle chains so we can
 * assert the assembled cards' trust glance, pagination math, the empty-page
 * short-circuit, AND (new in #36) the ORDER BY produced per sort plus the search
 * predicate threaded into both the page and count queries — without a live
 * database (docs/agents/testing.md).
 */

interface ListingRow {
  id: string;
  name: string;
  address: string;
}

const h = vi.hoisted(() => {
  const state = {
    pageListings: [] as ListingRow[],
    total: 0,
    celiacRows: [] as Array<Record<string, unknown>>,
    incidentRows: [] as Array<Record<string, unknown>>,
    // Captured ORDER BY args from the page query and the WHERE predicates.
    orderByArgs: [] as unknown[],
    pageWhere: undefined as unknown,
    countWhere: undefined as unknown,
  };

  // The page query chain (the celiac-trust JOIN form):
  //   select({listing}).from().leftJoin().where().orderBy().limit().offset()
  // The page query wraps each listing row as `{ listing }`.
  const offsetMock = vi.fn(() =>
    Promise.resolve(state.pageListings.map((listing) => ({ listing })))
  );
  const limitMock = vi.fn(() => ({ offset: offsetMock }));
  const orderByMock = vi.fn((...args: unknown[]) => {
    state.orderByArgs = args;
    return { limit: limitMock };
  });
  const pageWhereMock = vi.fn((predicate?: unknown) => {
    state.pageWhere = predicate;
    return { orderBy: orderByMock };
  });
  const pageLeftJoinMock = vi.fn(() => ({ where: pageWhereMock }));

  // The celiac-aggregate chain: select().from().leftJoin().where().groupBy()
  const groupByMock = vi.fn(() => Promise.resolve(state.celiacRows));
  const aggWhereMock = vi.fn(() => ({ groupBy: groupByMock }));

  // The celiac-trust SUBQUERY chain:
  //   select().from().leftJoin().where().groupBy().as()
  // It is a builder (not awaited) — `.as()` returns a subquery-like object.
  const subqueryGroupByMock = vi.fn(() => ({
    as: () => ({ listingId: {}, netConfirms: {}, lastConfirmedAt: {} }),
  }));
  const subqueryWhereMock = vi.fn(() => ({ groupBy: subqueryGroupByMock }));

  // `leftJoin` is used by BOTH the celiac-aggregate chain (→ where→groupBy, awaited)
  // and the subquery chain (→ where→groupBy→as, builder). They differ only by the
  // groupBy terminal, so we branch on call order: the subquery is built first in
  // `getBrowseListings`, the aggregate query runs later.
  let leftJoinCalls = 0;
  const leftJoinMock = vi.fn(() => {
    leftJoinCalls += 1;
    // First leftJoin in a run is the trust subquery builder.
    return leftJoinCalls === 1 ? { where: subqueryWhereMock } : { where: aggWhereMock };
  });

  // The incidents chain: select().from().where()
  const incidentWhereMock = vi.fn(() => Promise.resolve(state.incidentRows));

  // The page query's `.leftJoin` differs from the aggregate/subquery ones; we
  // route from() on whether a projection was given (page query selects {listing}).
  const fromMock = vi.fn(() => ({
    leftJoin: leftJoinMock, // celiac aggregate + trust subquery
    where: incidentWhereMock, // incidents
  }));

  const pageFromMock = vi.fn(() => ({ leftJoin: pageLeftJoinMock }));

  // The total-count chain is `select({ total }).from().where()`.
  const countWhereMock = vi.fn((predicate?: unknown) => {
    state.countWhere = predicate;
    return Promise.resolve([{ total: state.total }]);
  });
  const totalFromMock = vi.fn(() => ({ where: countWhereMock }));

  const selectMock = vi.fn((projection?: Record<string, unknown>) => {
    if (projection && "total" in projection) {
      return { from: totalFromMock };
    }
    if (projection && "listing" in projection) {
      return { from: pageFromMock };
    }
    return { from: fromMock };
  });

  const resetCallCounters = () => {
    leftJoinCalls = 0;
  };

  return { state, selectMock, resetCallCounters };
});

vi.mock("~/db/client", () => ({
  getDb: () => ({ select: h.selectMock }),
}));

import { getBrowseListings } from "./browse";

const { state } = h;
const NOW = new Date("2026-06-28T00:00:00Z");

// Render captured SQL ORDER BY args to inspect direction/columns.
const dialect = new PgDialect();
function renderArg(arg: unknown): string {
  return dialect.sqlToQuery(arg as SQL).sql.toLowerCase();
}

beforeEach(() => {
  state.pageListings = [];
  state.total = 0;
  state.celiacRows = [];
  state.incidentRows = [];
  state.orderByArgs = [];
  state.pageWhere = undefined;
  state.countWhere = undefined;
  h.resetCallCounters();
});

afterEach(() => {
  vi.clearAllMocks();
});

const baseInput = { page: 1, pageSize: 20, query: "", sort: "alpha" } as const;

describe("getBrowseListings", () => {
  it("returns an empty page (and skips signal queries) when there are no listings", async () => {
    state.pageListings = [];
    state.total = 0;

    const result = await getBrowseListings(baseInput, NOW);

    expect(result.cards).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(result.sort).toBe("alpha");
  });

  it("derives celiac-safe from a fresh confirm-majority aggregate", async () => {
    state.pageListings = [{ id: "l1", name: "Acme GF", address: "1 Main St" }];
    state.total = 1;
    state.celiacRows = [
      {
        listingId: "l1",
        claimId: "c1",
        lastConfirmedAt: new Date("2026-06-01T00:00:00Z"),
        confirmCount: "8",
        disputeCount: "1",
      },
    ];

    const result = await getBrowseListings(baseInput, NOW);

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.listing.name).toBe("Acme GF");
    expect(result.cards[0]?.glance.safetyState).toBe("celiac-safe");
    expect(result.cards[0]?.glance.hasRecentIncident).toBe(false);
  });

  it("shows Not yet attested (null state) for a listing with no celiac claim", async () => {
    state.pageListings = [{ id: "l1", name: "No Claims", address: "2 Main St" }];
    state.total = 1;
    state.celiacRows = []; // no celiac aggregate for this listing

    const result = await getBrowseListings(baseInput, NOW);

    expect(result.cards[0]?.glance.safetyState).toBeNull();
  });

  it("flags a recent incident regardless of confirmations", async () => {
    state.pageListings = [{ id: "l1", name: "Recently Hit", address: "3 Main St" }];
    state.total = 1;
    state.celiacRows = [
      {
        listingId: "l1",
        claimId: "c1",
        lastConfirmedAt: new Date("2026-06-01T00:00:00Z"),
        confirmCount: "8",
        disputeCount: "0",
      },
    ];
    // Incident 10 days ago — well inside the 90-day recency window.
    state.incidentRows = [{ listingId: "l1", occurredOn: "2026-06-18" }];

    const result = await getBrowseListings(baseInput, NOW);

    expect(result.cards[0]?.glance.safetyState).toBe("celiac-safe");
    expect(result.cards[0]?.glance.hasRecentIncident).toBe(true);
  });

  it("does NOT flag an out-of-window (old) incident", async () => {
    state.pageListings = [{ id: "l1", name: "Old Incident", address: "4 Main St" }];
    state.total = 1;
    // ~1 year old — outside the 90-day window.
    state.incidentRows = [{ listingId: "l1", occurredOn: "2025-06-18" }];

    const result = await getBrowseListings(baseInput, NOW);

    expect(result.cards[0]?.glance.hasRecentIncident).toBe(false);
  });

  it("computes pagination (hasMore + page) from total and offset", async () => {
    state.pageListings = [
      { id: "l1", name: "A", address: "a" },
      { id: "l2", name: "B", address: "b" },
    ];
    state.total = 5;

    const result = await getBrowseListings({ ...baseInput, pageSize: 2 }, NOW);

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(2);
    expect(result.total).toBe(5);
    expect(result.hasMore).toBe(true);
  });

  it("reports hasMore=false on the last page", async () => {
    state.pageListings = [{ id: "l5", name: "E", address: "e" }];
    state.total = 5;

    const result = await getBrowseListings({ ...baseInput, page: 3, pageSize: 2 }, NOW);

    expect(result.hasMore).toBe(false);
  });

  // --- #36: sort ordering ---------------------------------------------------

  it("orders by name ascending for the default alphabetical sort", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, sort: "alpha" }, NOW);

    // Single ORDER BY term: name ascending.
    expect(state.orderByArgs).toHaveLength(1);
    expect(renderArg(state.orderByArgs[0])).toContain('"name"');
    expect(renderArg(state.orderByArgs[0])).toContain("asc");
  });

  it("orders trust by displayed safety TIER, then net confirms, recency, name", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, sort: "trust" }, NOW);

    expect(state.orderByArgs).toHaveLength(4);
    const [first, second, third, fourth] = state.orderByArgs.map(renderArg);
    // SAFETY-CRITICAL: the displayed safety tier (a CASE over confirm/dispute +
    // staleness) leads — NOT raw net confirms — so a stale/contested listing
    // can't outrank a fresh celiac-safe one. Desc = safest tier first.
    expect(first).toContain("case");
    expect(first).toContain("desc");
    // Then net confirm consensus within the tier, desc.
    expect(second).toContain("coalesce");
    expect(second).toContain("desc");
    // Then recency, NULLS LAST, desc.
    expect(third).toContain("desc");
    expect(third).toContain("nulls last");
    // Stable name tiebreak last.
    expect(fourth).toContain('"name"');
  });

  it("threads the staleness cutoff into the trust tier so it matches the displayed window", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    // A 1-month admin window means the staleness cutoff is ~1 month before NOW.
    await getBrowseListings({ ...baseInput, sort: "trust" }, NOW, 1);

    const tierClause = dialect.sqlToQuery(state.orderByArgs[0] as SQL);
    // The cutoff Date is bound as a param (not hardcoded), proving the SQL
    // boundary is derived from the same `now`/`stalenessMonths` the glance uses.
    const boundDate = tierClause.params.find((p) => p instanceof Date) as Date | undefined;
    expect(boundDate).toBeInstanceOf(Date);
    const monthMs = 30 * 24 * 60 * 60 * 1000;
    expect(boundDate?.getTime()).toBe(NOW.getTime() - monthMs);
  });

  it("orders recency by last-confirmed desc (nulls last) before net confirms", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, sort: "recency" }, NOW);

    expect(state.orderByArgs).toHaveLength(3);
    const [first, second, third] = state.orderByArgs.map(renderArg);
    // Recency leads for the recency sort.
    expect(first).toContain("desc");
    expect(first).toContain("nulls last");
    // Then net confirms.
    expect(second).toContain("coalesce");
    expect(third).toContain('"name"');
  });

  it("echoes the applied sort back in the page result", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    const result = await getBrowseListings({ ...baseInput, sort: "trust" }, NOW);
    expect(result.sort).toBe("trust");
  });

  // --- #36: combinable with text search -------------------------------------

  it("applies the search predicate to BOTH the page and count queries (combinable with sort)", async () => {
    state.pageListings = [{ id: "l1", name: "Taco House", address: "1 Main St" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, query: "taco", sort: "trust" }, NOW);

    // Same non-undefined predicate threads into the page and the count query.
    expect(state.pageWhere).toBeDefined();
    expect(state.countWhere).toBeDefined();
    expect(dialect.sqlToQuery(state.pageWhere as SQL).params).toEqual(["%taco%", "%taco%"]);
    expect(dialect.sqlToQuery(state.countWhere as SQL).params).toEqual(["%taco%", "%taco%"]);
    // Sort still applied alongside the search filter (tier + net + recency + name).
    expect(state.orderByArgs).toHaveLength(4);
  });

  it("combines search + sort + pagination: same predicate on both queries, correct total/hasMore", async () => {
    // Page 2 of a "taco" search sorted by trust. Total 5 with pageSize 2 → page 2
    // holds rows 3–4, so hasMore is true (row 5 remains).
    state.pageListings = [
      { id: "l3", name: "Taco C", address: "3 Main St" },
      { id: "l4", name: "Taco D", address: "4 Main St" },
    ];
    state.total = 5;

    const result = await getBrowseListings(
      { page: 2, pageSize: 2, query: "taco", sort: "trust" },
      NOW
    );

    // The SAME search predicate is applied to the page AND the count query, so
    // the total (and thus hasMore) reflects the filtered set, not all listings.
    expect(dialect.sqlToQuery(state.pageWhere as SQL).params).toEqual(["%taco%", "%taco%"]);
    expect(dialect.sqlToQuery(state.countWhere as SQL).params).toEqual(["%taco%", "%taco%"]);
    expect(result.total).toBe(5);
    expect(result.page).toBe(2);
    expect(result.hasMore).toBe(true); // offset 2 + 2 rows < 5
    // Trust sort still applied under search + pagination.
    expect(state.orderByArgs).toHaveLength(4);
  });

  it("passes no WHERE predicate when the query is blank (shows everything)", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, query: "  " }, NOW);

    expect(state.pageWhere).toBeUndefined();
    expect(state.countWhere).toBeUndefined();
  });
});
