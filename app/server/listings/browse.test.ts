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
  };

  // The listings page chain: select().from().orderBy().limit().offset()
  const offsetMock = vi.fn(() => Promise.resolve(state.pageListings));
  const limitMock = vi.fn(() => ({ offset: offsetMock }));
  const orderByMock = vi.fn(() => ({ limit: limitMock }));

  // The celiac-aggregate chain: select().from().leftJoin().where().groupBy()
  const groupByMock = vi.fn(() => Promise.resolve(state.celiacRows));
  const aggWhereMock = vi.fn(() => ({ groupBy: groupByMock }));
  const leftJoinMock = vi.fn(() => ({ where: aggWhereMock }));

  // The incidents chain: select().from().where()
  const incidentWhereMock = vi.fn(() => Promise.resolve(state.incidentRows));

  // The listings page + celiac + incidents chains all start `select().from()…`.
  const fromMock = vi.fn(() => ({
    orderBy: orderByMock,
    leftJoin: leftJoinMock,
    where: incidentWhereMock,
  }));

  // The total-count chain is `select({ total }).from()` and is AWAITED directly
  // (no further chaining). We route on the select() argument: a `{ total }`
  // projection returns a promise of the count rows; everything else returns the
  // chainable `from`. This avoids a `then`-bearing object (biome noThenProperty).
  const totalFromMock = vi.fn(() => Promise.resolve([{ total: state.total }]));
  const selectMock = vi.fn((projection?: Record<string, unknown>) =>
    projection && "total" in projection ? { from: totalFromMock } : { from: fromMock }
  );

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

    const result = await getBrowseListings({ page: 1, pageSize: 20 }, NOW);

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

    const result = await getBrowseListings({ page: 1, pageSize: 20 }, NOW);

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.listing.name).toBe("Acme GF");
    expect(result.cards[0]?.glance.safetyState).toBe("celiac-safe");
    expect(result.cards[0]?.glance.hasRecentIncident).toBe(false);
  });

  it("shows Not yet attested (null state) for a listing with no celiac claim", async () => {
    state.pageListings = [{ id: "l1", name: "No Claims", address: "2 Main St" }];
    state.total = 1;
    state.celiacRows = []; // no celiac aggregate for this listing

    const result = await getBrowseListings({ page: 1, pageSize: 20 }, NOW);

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

    const result = await getBrowseListings({ page: 1, pageSize: 20 }, NOW);

    expect(result.cards[0]?.glance.safetyState).toBe("celiac-safe");
    expect(result.cards[0]?.glance.hasRecentIncident).toBe(true);
  });

  it("does NOT flag an out-of-window (old) incident", async () => {
    state.pageListings = [{ id: "l1", name: "Old Incident", address: "4 Main St" }];
    state.total = 1;
    // ~1 year old — outside the 90-day window.
    state.incidentRows = [{ listingId: "l1", occurredOn: "2025-06-18" }];

    const result = await getBrowseListings({ page: 1, pageSize: 20 }, NOW);

    expect(result.cards[0]?.glance.hasRecentIncident).toBe(false);
  });

  it("computes pagination (hasMore + page) from total and offset", async () => {
    state.pageListings = [
      { id: "l1", name: "A", address: "a" },
      { id: "l2", name: "B", address: "b" },
    ];
    state.total = 5;

    const result = await getBrowseListings({ page: 1, pageSize: 2 }, NOW);

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(2);
    expect(result.total).toBe(5);
    expect(result.hasMore).toBe(true);
  });

  it("reports hasMore=false on the last page", async () => {
    state.pageListings = [{ id: "l5", name: "E", address: "e" }];
    state.total = 5;

    const result = await getBrowseListings({ page: 3, pageSize: 2 }, NOW);

    expect(result.hasMore).toBe(false);
  });
});
