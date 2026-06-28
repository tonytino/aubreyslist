import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the browse-list loader (#33).
 *
 * `getBrowseListings` issues a FIXED number of batched queries (page of
 * listings, total count, one grouped celiac-aggregate query, one incidents
 * query) — no N+1. We model the distinct drizzle chains it uses so we can assert
 * the assembled cards' trust glance (celiac-safe / gluten-friendly / stale /
 * not-yet-attested + recent-incident flag), pagination math, and the empty-page
 * short-circuit, without a live database (docs/agents/testing.md).
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
    /** The WHERE predicate handed to the page query (filter + search compose). */
    pageWhere: undefined as unknown,
    /** The WHERE predicate handed to the count query (must match the page's). */
    countWhere: undefined as unknown,
  };

  // The listings page chain now carries a `.where()` before ordering:
  //   select().from().where().orderBy().limit().offset()
  const offsetMock = vi.fn(() => Promise.resolve(state.pageListings));
  const limitMock = vi.fn(() => ({ offset: offsetMock }));
  const orderByMock = vi.fn(() => ({ limit: limitMock }));
  const pageWhereMock = vi.fn((predicate?: unknown) => {
    state.pageWhere = predicate;
    return { orderBy: orderByMock };
  });

  // The celiac-aggregate chain: select(proj).from().leftJoin().where().groupBy()
  const groupByMock = vi.fn(() => Promise.resolve(state.celiacRows));
  const aggWhereMock = vi.fn(() => ({ groupBy: groupByMock }));
  const leftJoinMock = vi.fn(() => ({ where: aggWhereMock }));

  // The incidents chain: select(proj).from().where()  (awaited)
  const incidentWhereMock = vi.fn(() => Promise.resolve(state.incidentRows));

  // The count chain: select({ total }).from().where()  (awaited)
  const countWhereMock = vi.fn((predicate?: unknown) => {
    state.countWhere = predicate;
    return Promise.resolve([{ total: state.total }]);
  });

  // Route each query to the right chain by its select() projection:
  //  - no projection            → page listings  (full-row select)
  //  - { total }                → count
  //  - has `occurredOn`         → incidents
  //  - otherwise (claim cols)   → celiac aggregate
  const pageFromMock = vi.fn(() => ({ where: pageWhereMock }));
  const countFromMock = vi.fn(() => ({ where: countWhereMock }));
  const incidentFromMock = vi.fn(() => ({ where: incidentWhereMock }));
  const celiacFromMock = vi.fn(() => ({ leftJoin: leftJoinMock }));

  const selectMock = vi.fn((projection?: Record<string, unknown>) => {
    if (!projection) return { from: pageFromMock };
    if ("total" in projection) return { from: countFromMock };
    if ("occurredOn" in projection) return { from: incidentFromMock };
    return { from: celiacFromMock };
  });

  return { state, selectMock };
});

vi.mock("~/db/client", () => ({
  getDb: () => ({ select: h.selectMock }),
}));

import { getBrowseListings } from "./browse";

const { state } = h;
const NOW = new Date("2026-06-28T00:00:00Z");

beforeEach(() => {
  state.pageListings = [];
  state.total = 0;
  state.celiacRows = [];
  state.incidentRows = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getBrowseListings", () => {
  it("returns an empty page (and skips signal queries) when there are no listings", async () => {
    state.pageListings = [];
    state.total = 0;

    const result = await getBrowseListings({ page: 1, pageSize: 20, attrs: [] }, NOW);

    expect(result.cards).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
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

    const result = await getBrowseListings({ page: 1, pageSize: 20, attrs: [] }, NOW);

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.listing.name).toBe("Acme GF");
    expect(result.cards[0]?.glance.safetyState).toBe("celiac-safe");
    expect(result.cards[0]?.glance.hasRecentIncident).toBe(false);
  });

  it("shows Not yet attested (null state) for a listing with no celiac claim", async () => {
    state.pageListings = [{ id: "l1", name: "No Claims", address: "2 Main St" }];
    state.total = 1;
    state.celiacRows = []; // no celiac aggregate for this listing

    const result = await getBrowseListings({ page: 1, pageSize: 20, attrs: [] }, NOW);

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

    const result = await getBrowseListings({ page: 1, pageSize: 20, attrs: [] }, NOW);

    expect(result.cards[0]?.glance.safetyState).toBe("celiac-safe");
    expect(result.cards[0]?.glance.hasRecentIncident).toBe(true);
  });

  it("does NOT flag an out-of-window (old) incident", async () => {
    state.pageListings = [{ id: "l1", name: "Old Incident", address: "4 Main St" }];
    state.total = 1;
    // ~1 year old — outside the 90-day window.
    state.incidentRows = [{ listingId: "l1", occurredOn: "2025-06-18" }];

    const result = await getBrowseListings({ page: 1, pageSize: 20, attrs: [] }, NOW);

    expect(result.cards[0]?.glance.hasRecentIncident).toBe(false);
  });

  it("computes pagination (hasMore + page) from total and offset", async () => {
    state.pageListings = [
      { id: "l1", name: "A", address: "a" },
      { id: "l2", name: "B", address: "b" },
    ];
    state.total = 5;

    const result = await getBrowseListings({ page: 1, pageSize: 2, attrs: [] }, NOW);

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(2);
    expect(result.total).toBe(5);
    expect(result.hasMore).toBe(true);
  });

  it("reports hasMore=false on the last page", async () => {
    state.pageListings = [{ id: "l5", name: "E", address: "e" }];
    state.total = 5;

    const result = await getBrowseListings({ page: 3, pageSize: 2, attrs: [] }, NOW);

    expect(result.hasMore).toBe(false);
  });

  it("applies NO where filter when no attrs/search are given", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings({ page: 1, pageSize: 20, attrs: [] }, NOW);

    // No search term + no attributes → no constraint on either query.
    expect(state.pageWhere).toBeUndefined();
    expect(state.countWhere).toBeUndefined();
  });

  it("applies the SAME where predicate to the page and count when filtering", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings({ page: 1, pageSize: 20, attrs: ["dedicated_fryer"] }, NOW);

    // A taxonomy filter produces a real predicate, and BOTH queries get it so
    // the total count reflects the filter (pagination stays correct).
    expect(state.pageWhere).toBeDefined();
    expect(state.countWhere).toBeDefined();
    expect(state.countWhere).toBe(state.pageWhere);
  });

  it("composes a search term with taxonomy attrs into one predicate", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings(
      {
        page: 1,
        pageSize: 20,
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
});
