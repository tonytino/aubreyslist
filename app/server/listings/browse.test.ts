import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the browse-list loader (#33, extended for taxonomy filter in #35 and
 * sort in #36).
 *
 * `getBrowseListings` issues a FIXED number of batched queries (page of listings
 * LEFT JOINed to a per-listing celiac-trust subquery for ordering, a total count
 * under the SAME WHERE, one grouped celiac-aggregate query, one incidents query)
 * — no N+1. We model the distinct drizzle chains so we can assert the assembled
 * cards' trust glance, pagination math, the empty-page short-circuit, the ORDER
 * BY produced per sort (#36), AND the WHERE composed from search + taxonomy
 * filter (#34/#35) threaded into both the page and count queries — without a live
 * database (docs/agents/testing.md). The exact filter SQL shape is asserted in
 * `filter.test.ts`; here we assert composition (search + filter + sort + paging).
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
    /** Captured ORDER BY args from the page query. */
    orderByArgs: [] as unknown[],
    /** The WHERE predicate handed to the page query (filter + search compose). */
    pageWhere: undefined as unknown,
    /** The WHERE predicate handed to the count query (must match the page's). */
    countWhere: undefined as unknown,
  };

  // The page query chain (the celiac-trust JOIN form):
  //   select({listing}).from().leftJoin(trust).where().orderBy().limit().offset()
  // Each row is wrapped as `{ listing }` because of the projection.
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
  const pageFromMock = vi.fn(() => ({ leftJoin: pageLeftJoinMock }));

  // The celiac-aggregate chain: select(proj).from().leftJoin().where().groupBy()
  const groupByMock = vi.fn(() => Promise.resolve(state.celiacRows));
  const aggWhereMock = vi.fn(() => ({ groupBy: groupByMock }));

  // The celiac-trust SUBQUERY chain (builder, not awaited):
  //   select().from().leftJoin().where().groupBy().as()
  // `.as()` returns the subquery's referenceable columns.
  const subqueryGroupByMock = vi.fn(() => ({
    as: () => ({
      listingId: {},
      confirmCount: {},
      disputeCount: {},
      lastConfirmedAt: {},
    }),
  }));
  const subqueryWhereMock = vi.fn(() => ({ groupBy: subqueryGroupByMock }));

  // `leftJoin` is used by BOTH the trust subquery (→where→groupBy→as, a builder)
  // and the celiac-aggregate query (→where→groupBy, awaited). They differ only by
  // the groupBy terminal, so we branch on call order: the subquery is built first
  // in `getBrowseListings`, the aggregate query runs later.
  let leftJoinCalls = 0;
  const leftJoinMock = vi.fn(() => {
    leftJoinCalls += 1;
    return leftJoinCalls === 1 ? { where: subqueryWhereMock } : { where: aggWhereMock };
  });
  const celiacFromMock = vi.fn(() => ({ leftJoin: leftJoinMock }));

  // The incidents chain: select(proj).from().where()  (awaited)
  const incidentWhereMock = vi.fn(() => Promise.resolve(state.incidentRows));
  const incidentFromMock = vi.fn(() => ({ where: incidentWhereMock }));

  // The count chain: select({ total }).from().where()  (awaited)
  const countWhereMock = vi.fn((predicate?: unknown) => {
    state.countWhere = predicate;
    return Promise.resolve([{ total: state.total }]);
  });
  const countFromMock = vi.fn(() => ({ where: countWhereMock }));

  // Route each query to the right chain by its select() projection:
  //  - { listing }              → page listings (joined to the trust subquery)
  //  - { total }                → count
  //  - has `occurredOn`         → incidents
  //  - otherwise (claim cols)   → celiac aggregate / trust subquery
  const selectMock = vi.fn((projection?: Record<string, unknown>) => {
    if (projection && "listing" in projection) return { from: pageFromMock };
    if (projection && "total" in projection) return { from: countFromMock };
    if (projection && "occurredOn" in projection) return { from: incidentFromMock };
    return { from: celiacFromMock };
  });

  const resetCallCounters = () => {
    leftJoinCalls = 0;
  };

  return { state, selectMock, resetCallCounters };
});

vi.mock("~/db/client", () => ({
  getDb: () => ({ select: h.selectMock }),
}));

import { type BrowseListingsInput, getBrowseListings } from "./browse";

const { state } = h;
const NOW = new Date("2026-06-28T00:00:00Z");

// Render captured SQL to inspect direction/columns/params.
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

const baseInput: BrowseListingsInput = { page: 1, pageSize: 20, q: "", attrs: [], sort: "alpha" };

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

  // --- #34/#35: WHERE composition (search + taxonomy filter) ----------------

  it("applies NO where filter when no attrs/search are given", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings(baseInput, NOW);

    // No search term + no attributes → no constraint on either query.
    expect(state.pageWhere).toBeUndefined();
    expect(state.countWhere).toBeUndefined();
  });

  it("applies the SAME where predicate to the page and count when filtering", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, attrs: ["dedicated_fryer"] }, NOW);

    // A taxonomy filter produces a real predicate, and BOTH queries get it so
    // the total count reflects the filter (pagination stays correct).
    expect(state.pageWhere).toBeDefined();
    expect(state.countWhere).toBeDefined();
    expect(state.countWhere).toBe(state.pageWhere);
  });

  it("applies the search predicate to BOTH the page and count queries", async () => {
    state.pageListings = [{ id: "l1", name: "Taco House", address: "1 Main St" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, q: "taco", sort: "trust" }, NOW);

    expect(state.pageWhere).toBeDefined();
    expect(state.countWhere).toBeDefined();
    expect(dialect.sqlToQuery(state.pageWhere as SQL).params).toEqual(["%taco%", "%taco%"]);
    expect(dialect.sqlToQuery(state.countWhere as SQL).params).toEqual(["%taco%", "%taco%"]);
    // Sort still applied alongside the search filter (tier + net + recency + name).
    expect(state.orderByArgs).toHaveLength(4);
  });

  it("composes a search term with taxonomy attrs into one predicate", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings(
      {
        ...baseInput,
        q: "taco",
        attrs: ["dedicated_fryer", "celiac_safe_vs_gluten_friendly"],
      },
      NOW
    );

    // Search + filters compose into a single non-empty WHERE shared by both
    // queries (the actual SQL shape is asserted in filter.test.ts).
    expect(state.pageWhere).toBeDefined();
    expect(state.countWhere).toBe(state.pageWhere);
  });

  it("passes no WHERE predicate when the query is blank (shows everything)", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, q: "  " }, NOW);

    expect(state.pageWhere).toBeUndefined();
    expect(state.countWhere).toBeUndefined();
  });

  // --- The full compose: filter + search + sort + pagination ----------------

  it("combines filter + search + sort + pagination: shared WHERE, correct total/hasMore", async () => {
    // Page 2 of a "taco" search filtered to dedicated_fryer, sorted by trust.
    // Total 5 with pageSize 2 → page 2 holds rows 3–4, so hasMore is true.
    state.pageListings = [
      { id: "l3", name: "Taco C", address: "3 Main St" },
      { id: "l4", name: "Taco D", address: "4 Main St" },
    ];
    state.total = 5;

    const result = await getBrowseListings(
      { page: 2, pageSize: 2, q: "taco", attrs: ["dedicated_fryer"], sort: "trust" },
      NOW
    );

    // The SAME composed WHERE (search + filter) is applied to the page AND count
    // queries, so total/hasMore reflect the filtered set, not all listings.
    expect(state.pageWhere).toBeDefined();
    expect(state.countWhere).toBe(state.pageWhere);
    // The search term is part of that composed predicate.
    expect(dialect.sqlToQuery(state.pageWhere as SQL).params).toContain("%taco%");
    expect(result.total).toBe(5);
    expect(result.page).toBe(2);
    expect(result.hasMore).toBe(true); // offset 2 + 2 rows < 5
    expect(result.sort).toBe("trust");
    // Trust sort still applied under filter + search + pagination.
    expect(state.orderByArgs).toHaveLength(4);
  });
});
