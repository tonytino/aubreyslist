import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Structural tests for the listing-activity loader.
 *
 * The two values here drive a user-visible line that is deliberately EXEMT
 * from the contested-suppression rule (owner decision 2026-08-25), so the SQL
 * has to mean exactly what the copy says. Bare "contains max(" assertions
 * would pass through a dropped DISTINCT, a flipped confirm/dispute side, or a
 * lost incident exclusion, so the rendered SQL is pinned by shape:
 *
 *  - the recency is `max(created_at)`, not `updated_at` and not an incident date,
 *  - "happy patrons" counts DISTINCT users, filtered to confirms, minus anyone
 *    who filed a visible incident on the same listing, and
 *  - only visible claims contribute (the same bound the neighbouring browse
 *    aggregates apply).
 *
 * The db client is mocked the way `browse.test.ts` does it: a `getDb()` whose
 * `select()` chain records its projection + predicate and resolves to fixture
 * rows, so no live database is needed (docs/agents/testing.md).
 */

const h = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
    projection: undefined as Record<string, unknown> | undefined,
    where: undefined as unknown,
  };

  const groupByMock = vi.fn(() => Promise.resolve(state.rows));
  const whereMock = vi.fn((predicate?: unknown) => {
    state.where = predicate;
    return { groupBy: groupByMock };
  });
  const innerJoinMock = vi.fn(() => ({ where: whereMock }));
  const fromMock = vi.fn(() => ({ innerJoin: innerJoinMock }));
  const selectMock = vi.fn((projection?: Record<string, unknown>) => {
    state.projection = projection;
    return { from: fromMock };
  });

  return { state, selectMock };
});

vi.mock("~/db/client", () => ({
  getDb: () => ({ select: h.selectMock }),
}));

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { getListingActivity, getListingActivityByListing } from "./activity";

const { state } = h;
const dialect = new PgDialect();

/** Render one projected expression (or the WHERE) to lowercase SQL text. */
function render(value: unknown): string {
  return dialect.sqlToQuery(value as SQL).sql.toLowerCase();
}

/** The rendered `happy_patrons` aggregate expression. */
function happyPatronsSql(): string {
  return render(state.projection?.happyPatrons);
}

beforeEach(() => {
  state.rows = [];
  state.projection = undefined;
  state.where = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getListingActivityByListing (batching + mapping)", () => {
  it("runs no query at all for an empty id set", async () => {
    expect(await getListingActivityByListing([])).toEqual(new Map());
    expect(h.selectMock).not.toHaveBeenCalled();
  });

  it("issues ONE grouped query for the whole page (no N+1)", async () => {
    await getListingActivityByListing(["l1", "l2", "l3"]);
    expect(h.selectMock).toHaveBeenCalledTimes(1);
  });

  it("maps rows to the activity pair, coercing the driver's count and timestamp", async () => {
    // `count(...)` arrives as a string from some drivers, and a timestamp may
    // arrive as an ISO string — both must land as a real number / real Date.
    state.rows = [
      { listingId: "l1", lastActivityAt: "2026-06-20T10:00:00.000Z", happyPatrons: "4" },
      { listingId: "l2", lastActivityAt: new Date("2026-06-21T00:00:00Z"), happyPatrons: 0 },
    ];

    const byListing = await getListingActivityByListing(["l1", "l2"]);

    expect(byListing.get("l1")).toEqual({
      lastActivityAt: new Date("2026-06-20T10:00:00.000Z"),
      happyPatrons: 4,
    });
    expect(byListing.get("l2")?.happyPatrons).toBe(0);
    expect(byListing.get("l2")?.lastActivityAt).toBeInstanceOf(Date);
  });

  it("omits a listing with no attestation rows, so the caller shows the empty state", async () => {
    state.rows = [];
    const byListing = await getListingActivityByListing(["l1"]);
    expect(byListing.has("l1")).toBe(false);
  });
});

describe("getListingActivity (single-listing read for the detail hero)", () => {
  it("reuses the batched loader so the hero and the card cannot disagree", async () => {
    state.rows = [
      { listingId: "l1", lastActivityAt: new Date("2026-06-20T00:00:00Z"), happyPatrons: "2" },
    ];
    expect(await getListingActivity("l1")).toEqual({
      lastActivityAt: new Date("2026-06-20T00:00:00Z"),
      happyPatrons: 2,
    });
    expect(h.selectMock).toHaveBeenCalledTimes(1);
  });

  it("returns null for a listing with no activity", async () => {
    state.rows = [];
    expect(await getListingActivity("l1")).toBeNull();
  });
});

describe("the rendered SQL means what the copy says", () => {
  beforeEach(async () => {
    await getListingActivityByListing(["l1"]);
  });

  it("takes the recency from the attestation's CREATED_AT, never updated_at", async () => {
    // The line reports when a vote was cast. Re-saving the same vote bumps
    // `updated_at`, and using it would let a no-op edit refresh "Updated …".
    const sql = render(state.projection?.lastActivityAt);
    expect(sql).toContain("max(");
    expect(sql).toContain('"created_at"');
    expect(sql).not.toContain('"updated_at"');
  });

  it("never reads incidents for the recency — harm keeps its own signal", () => {
    // An incident must not read as ordinary upkeep on this line.
    const sql = render(state.projection?.lastActivityAt);
    expect(sql).not.toContain("occurred_on");
    expect(sql).not.toContain("incidents");
  });

  it("counts DISTINCT users, so one person attesting five claims counts once", () => {
    expect(happyPatronsSql()).toContain("count(distinct");
    expect(happyPatronsSql()).toContain('"user_id"');
  });

  it("counts CONFIRMS only — a dispute-only voter is activity, not a happy patron", () => {
    const sql = happyPatronsSql();
    // The FILTER carries the confirm side explicitly…
    expect(sql).toContain("filter (");
    expect(sql).toContain("'confirm'");
    // …and never the dispute side, which would silently double the count.
    expect(sql).not.toContain("'dispute'");
  });

  it("excludes anyone who reported an incident here, correlated on BOTH user and listing", () => {
    const sql = happyPatronsSql();
    expect(sql).toContain("not exists");
    // Correlated on the same listing AND the same voter: dropping either half
    // would exclude every patron of any listing with a single report, or
    // exclude a reporter from listings they never reported.
    expect(sql).toContain('"incidents"."listing_id" = "claims"."listing_id"');
    expect(sql).toContain('"incidents"."user_id" = "attestations"."user_id"');
    // Only VISIBLE incidents disqualify, matching the card's incident flag —
    // a moderated-away report cannot silently un-happy a patron.
    expect(sql).toContain('"incidents"."moderation_status" = \'visible\'');
  });

  it("bounds the whole query to VISIBLE claims, like its sibling aggregates", () => {
    const sql = render(state.where);
    expect(sql).toContain("moderation_status");
    expect(dialect.sqlToQuery(state.where as SQL).params).toContain("visible");
  });

  it("scopes to the requested listing ids (the batching key)", () => {
    expect(dialect.sqlToQuery(state.where as SQL).params).toContain("l1");
  });
});
