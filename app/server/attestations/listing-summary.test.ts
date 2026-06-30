import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the listing-level claim-aggregate loader (#29, extended for #32).
 *
 * The module's server-only deps are the DB client and the current-user resolver.
 * We model the two drizzle chains it uses:
 *   - aggregates: select().from().leftJoin().innerJoin().where().groupBy() -> grouped rows
 *   - viewer vote: select().from().innerJoin().innerJoin().where()         -> own-vote rows
 * so we can assert the row-shaping and the per-claim `viewerVote` (#32) without a
 * live database, per docs/agents/testing.md. Both chains INNER JOIN `listings` to
 * gate on the parent listing's visibility (no parent→child moderation propagation).
 */

const h = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
    viewerVoteRows: [] as Array<{ claimId: string; value: string }>,
    viewer: null as { id: string } | null,
    aggWhere: undefined as unknown,
    voteWhere: undefined as unknown,
  };

  // Aggregate chain: select().from().leftJoin(attestations).innerJoin(listings)
  //   .where().groupBy(). The innerJoin(listings) is the parent-visibility gate.
  const groupByMock = vi.fn(() => Promise.resolve(state.rows));
  const aggWhereMock = vi.fn((predicate?: unknown) => {
    state.aggWhere = predicate;
    return { groupBy: groupByMock };
  });
  const aggInnerJoinMock = vi.fn(() => ({ where: aggWhereMock }));
  const leftJoinMock = vi.fn(() => ({ innerJoin: aggInnerJoinMock }));

  // Viewer-vote chain: select().from().innerJoin(claims).innerJoin(listings)
  //   .where() (terminal, awaited). The second innerJoin is the parent gate.
  const voteWhereMock = vi.fn((predicate?: unknown) => {
    state.voteWhere = predicate;
    return Promise.resolve(state.viewerVoteRows);
  });
  const voteListingsJoinMock = vi.fn(() => ({ where: voteWhereMock }));
  const innerJoinMock = vi.fn(() => ({ innerJoin: voteListingsJoinMock }));

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

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { getListingClaimAggregates } from "./listing-summary";

const { state, selectMock, getCurrentUserMock } = h;
const dialect = new PgDialect();

beforeEach(() => {
  state.rows = [];
  state.viewerVoteRows = [];
  state.viewer = null;
  state.aggWhere = undefined;
  state.voteWhere = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

// The fixed GF taxonomy (db/schema.ts `claim_attribute`). The loader always
// returns ONE ENTRY PER attribute (#150), in this canonical order.
const TAXONOMY = [
  "celiac_safe_vs_gluten_friendly",
  "dedicated_fryer",
  "dedicated_gf_menu",
  "off_menu_gf_on_request",
  "gf_substitutes",
] as const;

describe("getListingClaimAggregates — full taxonomy, attestable (#150)", () => {
  it("returns ONE ENTRY PER taxonomy attribute, merging the existing claim row", async () => {
    const when = new Date("2026-06-01T00:00:00Z");
    // Only one attribute has a claim row; `count(...) filter` arrives as a string.
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

    // All taxonomy attributes, in canonical order.
    expect(result.map((r) => r.attribute)).toEqual([...TAXONOMY]);
    // Anonymous viewer ⇒ only the aggregate query runs (no viewer-vote query).
    expect(selectMock).toHaveBeenCalledTimes(1);

    // The attribute with a claim merges in its counts/recency (coerced to number).
    const fryer = result.find((r) => r.attribute === "dedicated_fryer");
    expect(fryer).toEqual({
      claimId: "c1",
      attribute: "dedicated_fryer",
      lastConfirmedAt: when,
      confirmCount: 8,
      disputeCount: 1,
      viewerVote: null,
    });
  });

  it("emits an honest EMPTY entry (claimId null, zero counts) for un-attested attributes", async () => {
    // No claim rows at all: every attribute is attestable from a zero state.
    state.rows = [];

    const result = await getListingClaimAggregates({ listingId: "listing-empty" });

    expect(result).toHaveLength(TAXONOMY.length);
    for (const entry of result) {
      expect(entry.claimId).toBeNull();
      expect(entry.confirmCount).toBe(0);
      expect(entry.disputeCount).toBe(0);
      expect(entry.lastConfirmedAt).toBeNull();
      expect(entry.viewerVote).toBeNull();
    }
  });

  it("attaches the signed-in viewer's own vote per attribute (#32)", async () => {
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
    expect(result.find((c) => c.attribute === "dedicated_fryer")?.viewerVote).toBe("confirm");
    expect(result.find((c) => c.attribute === "dedicated_gf_menu")?.viewerVote).toBe("dispute");
    // An un-attested attribute still has no viewer vote.
    expect(result.find((c) => c.attribute === "gf_substitutes")?.viewerVote).toBeNull();
  });

  it("excludes hidden/removed claims from the PUBLIC aggregate (#41)", async () => {
    state.rows = [
      {
        claimId: "c1",
        attribute: "dedicated_fryer",
        lastConfirmedAt: null,
        confirmCount: "3",
        disputeCount: "0",
      },
    ];

    await getListingClaimAggregates({ listingId: "listing-1" });

    // The aggregate WHERE constrains to `moderation_status = 'visible'`, so a
    // hidden/removed claim drops off the surface AND out of the headline cue,
    // whose counts then recompute from the surviving visible claims. A moderated
    // attribute simply falls back to its honest empty entry.
    const lower = dialect.sqlToQuery(state.aggWhere as SQL).sql.toLowerCase();
    expect(lower).toContain("moderation_status");
    expect(dialect.sqlToQuery(state.aggWhere as SQL).params).toContain("visible");
  });

  it("ALSO requires the PARENT listing visible — hidden/removed listing leaks no claim aggregates (no propagation)", async () => {
    // `moderationStatus` has no parent→child propagation: hiding the LISTING
    // leaves its claims `visible`. The aggregate query INNER JOINs `listings` and
    // its WHERE additionally requires the listings table's
    // `moderation_status = 'visible'`, so a hidden listing yields zero aggregate
    // rows — every attribute then falls back to its honest empty entry. With a
    // real hidden parent the rows arrive empty; here we assert the predicate.
    state.rows = [];

    const result = await getListingClaimAggregates({ listingId: "listing-hidden" });

    const query = dialect.sqlToQuery(state.aggWhere as SQL);
    const lower = query.sql.toLowerCase();
    expect(lower).toContain('"listings"."moderation_status"');
    expect(lower).toContain('"claims"."moderation_status"');
    // Two `'visible'` binds: the claim's own status AND the parent listing's.
    expect(query.params.filter((p) => p === "visible")).toHaveLength(2);
    // A hidden parent's empty aggregate ⇒ every attribute is an honest empty entry.
    for (const entry of result) {
      expect(entry.claimId).toBeNull();
      expect(entry.confirmCount).toBe(0);
      expect(entry.disputeCount).toBe(0);
    }
  });

  it("scopes the viewer-vote query to the visible PARENT listing too (defense-in-depth)", async () => {
    state.rows = [
      {
        claimId: "c1",
        attribute: "dedicated_fryer",
        lastConfirmedAt: null,
        confirmCount: "1",
        disputeCount: "0",
      },
    ];
    state.viewer = { id: "user-1" };
    state.viewerVoteRows = [{ claimId: "c1", value: "confirm" }];

    await getListingClaimAggregates({ listingId: "listing-1" });

    const query = dialect.sqlToQuery(state.voteWhere as SQL);
    const lower = query.sql.toLowerCase();
    expect(lower).toContain('"listings"."moderation_status"');
    expect(query.params).toContain("visible");
  });

  it("leaves viewerVote null for attributes the signed-in viewer has not voted on", async () => {
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
    expect(result.find((c) => c.attribute === "dedicated_fryer")?.viewerVote).toBeNull();
  });
});
