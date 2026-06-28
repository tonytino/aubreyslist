import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the listing-level claim-aggregate loader (#29).
 *
 * The module's only server-only dependency is the DB client. We model the exact
 * drizzle chain it uses — select().from().leftJoin().where().groupBy() — so we
 * can assert the row-shaping (string count coercion, empty listing → []) without
 * a live database, per docs/agents/testing.md.
 */

// DB chain modeled:
//   getDb().select().from().leftJoin().where().groupBy() -> grouped rows
const h = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
  };
  const groupByMock = vi.fn(() => Promise.resolve(state.rows));
  const whereMock = vi.fn(() => ({ groupBy: groupByMock }));
  const leftJoinMock = vi.fn(() => ({ where: whereMock }));
  const fromMock = vi.fn(() => ({ leftJoin: leftJoinMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));
  return { state, groupByMock, whereMock, leftJoinMock, fromMock, selectMock };
});

vi.mock("~/db/client", () => ({
  getDb: () => ({ select: h.selectMock }),
}));

import { getListingClaimAggregates } from "./listing-summary";

const { state, selectMock, whereMock } = h;

beforeEach(() => {
  state.rows = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getListingClaimAggregates", () => {
  it("coerces string counts to numbers and passes through attribute + recency", async () => {
    const when = new Date("2026-06-01T00:00:00Z");
    // Postgres `count(...) filter` arrives as a string over the wire.
    state.rows = [
      {
        claimId: "c1",
        attribute: "dedicated_fryer",
        lastConfirmedAt: when,
        confirmCount: "8",
        disputeCount: "1",
      },
    ];

    const result = await getListingClaimAggregates({ listingId: "listing-1" });

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(whereMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        claimId: "c1",
        attribute: "dedicated_fryer",
        lastConfirmedAt: when,
        confirmCount: 8,
        disputeCount: 1,
      },
    ]);
  });

  it("returns zero counts for a claim with no attestations (left join, no rows)", async () => {
    state.rows = [
      {
        claimId: "c2",
        attribute: "dedicated_gf_menu",
        lastConfirmedAt: null,
        confirmCount: "0",
        disputeCount: "0",
      },
    ];

    const result = await getListingClaimAggregates({ listingId: "listing-1" });
    const agg = result[0];

    expect(agg).toBeDefined();
    expect(agg?.confirmCount).toBe(0);
    expect(agg?.disputeCount).toBe(0);
    expect(agg?.lastConfirmedAt).toBeNull();
  });

  it("returns [] for a listing with no claims", async () => {
    state.rows = [];
    const result = await getListingClaimAggregates({ listingId: "listing-empty" });
    expect(result).toEqual([]);
  });
});
