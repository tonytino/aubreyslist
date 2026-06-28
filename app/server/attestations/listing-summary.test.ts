import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the listing-level claim-aggregate loader (#29, extended for #32).
 *
 * The module's server-only deps are the DB client and the current-user resolver.
 * We model the two drizzle chains it uses:
 *   - aggregates: select().from().leftJoin().where().groupBy()  -> grouped rows
 *   - viewer vote: select().from().innerJoin().where()          -> own-vote rows
 * so we can assert the row-shaping and the per-claim `viewerVote` (#32) without a
 * live database, per docs/agents/testing.md.
 */

const h = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
    viewerVoteRows: [] as Array<{ claimId: string; value: string }>,
    viewer: null as { id: string } | null,
  };

  // Aggregate chain: select().from().leftJoin().where().groupBy().
  const groupByMock = vi.fn(() => Promise.resolve(state.rows));
  const aggWhereMock = vi.fn(() => ({ groupBy: groupByMock }));
  const leftJoinMock = vi.fn(() => ({ where: aggWhereMock }));

  // Viewer-vote chain: select().from().innerJoin().where() (terminal, awaited).
  const voteWhereMock = vi.fn(() => Promise.resolve(state.viewerVoteRows));
  const innerJoinMock = vi.fn(() => ({ where: voteWhereMock }));

  // `from()` may continue to either leftJoin (aggregates) or innerJoin (votes).
  const fromMock = vi.fn(() => ({ leftJoin: leftJoinMock, innerJoin: innerJoinMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  const getCurrentUserMock = vi.fn(() => Promise.resolve(state.viewer));

  return { state, groupByMock, aggWhereMock, selectMock, getCurrentUserMock };
});

vi.mock("~/db/client", () => ({
  getDb: () => ({ select: h.selectMock }),
}));

vi.mock("~/server/auth/current-user", () => ({
  getCurrentUser: h.getCurrentUserMock,
}));

import { getListingClaimAggregates } from "./listing-summary";

const { state, selectMock, getCurrentUserMock } = h;

beforeEach(() => {
  state.rows = [];
  state.viewerVoteRows = [];
  state.viewer = null;
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

    // Anonymous viewer ⇒ only the aggregate query runs (no viewer-vote query).
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        claimId: "c1",
        attribute: "dedicated_fryer",
        lastConfirmedAt: when,
        confirmCount: 8,
        disputeCount: 1,
        viewerVote: null,
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
    expect(agg?.viewerVote).toBeNull();
  });

  it("returns [] for a listing with no claims", async () => {
    state.rows = [];
    const result = await getListingClaimAggregates({ listingId: "listing-empty" });
    expect(result).toEqual([]);
  });

  it("attaches the signed-in viewer's own vote per claim (#32)", async () => {
    state.rows = [
      {
        claimId: "c1",
        attribute: "dedicated_fryer",
        lastConfirmedAt: null,
        confirmCount: "1",
        disputeCount: "0",
      },
      {
        claimId: "c2",
        attribute: "dedicated_gf_menu",
        lastConfirmedAt: null,
        confirmCount: "0",
        disputeCount: "1",
      },
    ];
    state.viewer = { id: "user-1" };
    // The viewer confirmed c1 and disputed c2.
    state.viewerVoteRows = [
      { claimId: "c1", value: "confirm" },
      { claimId: "c2", value: "dispute" },
    ];

    const result = await getListingClaimAggregates({ listingId: "listing-1" });

    expect(getCurrentUserMock).toHaveBeenCalledTimes(1);
    // Two queries: aggregates + the viewer's own votes.
    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(result.find((c) => c.claimId === "c1")?.viewerVote).toBe("confirm");
    expect(result.find((c) => c.claimId === "c2")?.viewerVote).toBe("dispute");
  });

  it("leaves viewerVote null for claims the signed-in viewer has not voted on", async () => {
    state.rows = [
      {
        claimId: "c1",
        attribute: "dedicated_fryer",
        lastConfirmedAt: null,
        confirmCount: "0",
        disputeCount: "0",
      },
    ];
    state.viewer = { id: "user-1" };
    state.viewerVoteRows = []; // no votes by this user on this listing

    const result = await getListingClaimAggregates({ listingId: "listing-1" });
    expect(result[0]?.viewerVote).toBeNull();
  });
});
