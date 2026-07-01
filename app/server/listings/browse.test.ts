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
  /**
   * When set, the page query row carries this per-row distance (km) — the mock
   * attaches it alongside `{ listing }`, mirroring the real distance-sort SELECT
   * so the assembled card's `distanceLabel` can be asserted.
   */
  distanceKm?: number;
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
    /** The WHERE predicate handed to the celiac-aggregate query (#41 visibility). */
    aggWhere: undefined as unknown,
    /** The WHERE predicate handed to the trust subquery (#41 visibility). */
    subqueryWhere: undefined as unknown,
    /** The WHERE predicate handed to the incidents query (#41 visibility). */
    incidentWhere: undefined as unknown,
  };

  // The page query chain (the celiac-trust JOIN form):
  //   select({listing}).from().leftJoin(trust).where().orderBy().limit().offset()
  // Each row is wrapped as `{ listing }` because of the projection.
  const offsetMock = vi.fn(() =>
    Promise.resolve(
      state.pageListings.map(({ distanceKm, ...listing }) =>
        // Mirror the real projection: `{ listing }`, plus `distanceKm` when the
        // fixture supplies one (the distance-sort SELECT adds that column).
        distanceKm === undefined ? { listing } : { listing, distanceKm }
      )
    )
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
  const aggWhereMock = vi.fn((predicate?: unknown) => {
    state.aggWhere = predicate;
    return { groupBy: groupByMock };
  });

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
  const subqueryWhereMock = vi.fn((predicate?: unknown) => {
    state.subqueryWhere = predicate;
    return { groupBy: subqueryGroupByMock };
  });

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
  const incidentWhereMock = vi.fn((predicate?: unknown) => {
    state.incidentWhere = predicate;
    return Promise.resolve(state.incidentRows);
  });
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

import {
  DEFAULT_STALENESS_MONTHS,
  deriveHeadlineSafetyState,
  safetyTierRank,
  stalenessCutoff,
} from "~/trust/summary";
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
  state.aggWhere = undefined;
  state.subqueryWhere = undefined;
  state.incidentWhere = undefined;
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

  it("surfaces evidence counts (confirmations + distinct contributors) from the aggregate", async () => {
    state.pageListings = [{ id: "l1", name: "Acme GF", address: "1 Main St" }];
    state.total = 1;
    // The grouped celiac-aggregate query computes `contributors` in-batch as
    // count(distinct user_id) — asserted here as a plain passthrough count.
    state.celiacRows = [
      {
        listingId: "l1",
        claimId: "c1",
        lastConfirmedAt: new Date("2026-06-25T00:00:00Z"),
        confirmCount: "8",
        disputeCount: "1",
        contributors: "6",
      },
    ];

    const result = await getBrowseListings(baseInput, NOW);

    expect(result.cards[0]?.glance.evidence).toEqual({ confirmations: 8, contributors: 6 });
  });

  it("omits evidence counts (null) for a claim with zero votes", async () => {
    state.pageListings = [{ id: "l1", name: "Acme GF", address: "1 Main St" }];
    state.total = 1;
    state.celiacRows = [
      {
        listingId: "l1",
        claimId: "c1",
        lastConfirmedAt: null,
        confirmCount: "0",
        disputeCount: "0",
        contributors: "0",
      },
    ];

    const result = await getBrowseListings(baseInput, NOW);

    // A zero-vote claim shows the honest empty state, never "0 confirmations".
    expect(result.cards[0]?.glance.evidence).toBeNull();
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

  it("classifies the staleness boundary the same as the glance (inclusive >=, NULL = fresh)", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, sort: "trust" }, NOW);

    // The trust tier CASE is the first ORDER BY term. Its `fresh` predicate must
    // mirror `isStale` exactly: an INCLUSIVE lower bound (`>=`, so an exact-edge
    // confirmation is fresh, not flipped to stale) and NULL lastConfirmedAt
    // counted as fresh (a never-confirmed confirm-majority is celiac-safe, not
    // stale — ADR-007), not bare `>` which would drift from the displayed card.
    const tierSql = renderArg(state.orderByArgs[0]);
    expect(tierSql).toContain(">=");
    expect(tierSql).toContain("is null");
    expect(tierSql).not.toContain("> $"); // no bare strict `>` against the cutoff param
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

  // --- #37: "near me" distance sort -----------------------------------------

  it("orders distance by the haversine term ascending, then name, when coords are given", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings(
      { ...baseInput, sort: "distance", userLat: 39.7392, userLng: -104.9903 },
      NOW
    );

    // Two ORDER BY terms: the haversine distance (asc), then the name tiebreak.
    expect(state.orderByArgs).toHaveLength(2);
    const [distance, tiebreak] = state.orderByArgs.map(renderArg);
    // The distance term is the haversine: sin/cos over radians of the lat/lng
    // deltas, ascending (closest first).
    expect(distance).toContain("radians");
    expect(distance).toContain("sin");
    expect(distance).toContain("cos");
    expect(distance).toContain("asc");
    // The user's coords are bound as params (not hardcoded into the SQL).
    const params = dialect.sqlToQuery(state.orderByArgs[0] as SQL).params;
    expect(params).toContain(39.7392);
    expect(params).toContain(-104.9903);
    // Stable name tiebreak last.
    expect(tiebreak).toContain('"name"');
  });

  it("falls back to alphabetical for distance sort when NO coords are supplied", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    // sort=distance but the user denied/unavailable geolocation (no coords).
    await getBrowseListings({ ...baseInput, sort: "distance" }, NOW);

    // Degrades to the stable single-term alphabetical order rather than erroring.
    expect(state.orderByArgs).toHaveLength(1);
    expect(renderArg(state.orderByArgs[0])).toContain('"name"');
    expect(renderArg(state.orderByArgs[0])).toContain("asc");
  });

  it("falls back to alphabetical when only HALF a coordinate pair is supplied", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    // A lone lat (no lng) is meaningless for distance → fall back, don't error.
    await getBrowseListings({ ...baseInput, sort: "distance", userLat: 39.7392 }, NOW);

    expect(state.orderByArgs).toHaveLength(1);
    expect(renderArg(state.orderByArgs[0])).toContain('"name"');
  });

  it("echoes distance back as the applied sort even when it fell back to alpha order", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    const result = await getBrowseListings({ ...baseInput, sort: "distance" }, NOW);
    // The applied sort token is still "distance" (the UI reflects the user's
    // selection); only the ORDER BY degraded.
    expect(result.sort).toBe("distance");
  });

  it("combines distance sort with search + filters (shared WHERE, distance ORDER BY)", async () => {
    state.pageListings = [{ id: "l1", name: "Taco House", address: "1 Main St" }];
    state.total = 1;

    await getBrowseListings(
      {
        ...baseInput,
        q: "taco",
        attrs: ["dedicated_fryer"],
        sort: "distance",
        userLat: 39.7392,
        userLng: -104.9903,
      },
      NOW
    );

    // Search + filter compose into the SAME WHERE on both queries; the distance
    // sort only changes the ORDER BY.
    expect(state.pageWhere).toBeDefined();
    expect(state.countWhere).toBe(state.pageWhere);
    expect(dialect.sqlToQuery(state.pageWhere as SQL).params).toContain("%taco%");
    expect(state.orderByArgs).toHaveLength(2);
    expect(renderArg(state.orderByArgs[0])).toContain("radians");
  });

  it("labels each card's distance (mi) from the selected per-row distance km", async () => {
    // The distance-sort SELECT adds a `distanceKm` column; the loader converts it
    // to a "0.4 mi" label per card. ~0.644 km ≈ 0.4 mi.
    state.pageListings = [{ id: "l1", name: "A", address: "a", distanceKm: 0.643_738 }];
    state.total = 1;

    const result = await getBrowseListings(
      { ...baseInput, sort: "distance", userLat: 39.7392, userLng: -104.9903 },
      NOW
    );

    expect(result.cards[0]?.distanceLabel).toBe("0.4 mi");
  });

  it("omits the distance label when NOT distance-sorting (no distance column)", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    const result = await getBrowseListings({ ...baseInput, sort: "alpha" }, NOW);

    expect(result.cards[0]?.distanceLabel).toBeUndefined();
  });

  // --- #34/#35: WHERE composition (search + taxonomy filter) ----------------

  it("always constrains to visible listings even when no attrs/search are given (#41)", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings(baseInput, NOW);

    // No search term + no attributes → the ONLY constraint is the visibility
    // predicate (hidden/removed listings are excluded from this public read),
    // applied identically to both the page and count queries.
    expect(state.pageWhere).toBeDefined();
    expect(state.countWhere).toBe(state.pageWhere);
    const sql = renderArg(state.pageWhere);
    expect(sql).toContain("moderation_status");
    expect(dialect.sqlToQuery(state.pageWhere as SQL).params).toContain("visible");
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
    // The composed WHERE is `visible AND (name ILIKE ? OR address ILIKE ?)`, so
    // the bound params are the visibility literal followed by the two `%term%`s.
    expect(dialect.sqlToQuery(state.pageWhere as SQL).params).toEqual([
      "visible",
      "%taco%",
      "%taco%",
    ]);
    expect(dialect.sqlToQuery(state.countWhere as SQL).params).toEqual([
      "visible",
      "%taco%",
      "%taco%",
    ]);
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

  it("applies only the visibility predicate when the query is blank (shows all VISIBLE)", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, q: "  " }, NOW);

    // A blank search adds no text constraint, but the public read still excludes
    // hidden/removed listings (#41).
    expect(state.pageWhere).toBeDefined();
    expect(state.countWhere).toBe(state.pageWhere);
    expect(dialect.sqlToQuery(state.pageWhere as SQL).params).toContain("visible");
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

// ---------------------------------------------------------------------------
// #41: every browse signal query excludes non-visible content + recomputes
// ---------------------------------------------------------------------------
describe("browse visibility filtering (#41)", () => {
  it("filters the celiac aggregate, the trust subquery, AND incidents to visible", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings(baseInput, NOW);

    // The headline celiac aggregate excludes hidden/removed claims, so a card's
    // confirm/dispute counts recompute from the surviving visible claims.
    expect(renderArg(state.aggWhere)).toContain("moderation_status");
    expect(dialect.sqlToQuery(state.aggWhere as SQL).sql.toLowerCase()).toContain("'visible'");

    // The trust-sort subquery excludes hidden/removed claims too.
    expect(dialect.sqlToQuery(state.subqueryWhere as SQL).sql.toLowerCase()).toContain("'visible'");

    // The recent-incident signal excludes hidden/removed incidents, so a
    // moderated-away incident no longer flags the card — but a still-visible one
    // always does ("recent harm is never buried").
    expect(renderArg(state.incidentWhere)).toContain("moderation_status");
    expect(dialect.sqlToQuery(state.incidentWhere as SQL).params).toContain("visible");
  });

  it("recomputes the recent-incident flag from VISIBLE incidents only — none survive → no flag", async () => {
    // The browse incidents query excludes hidden incidents at the DB (asserted in
    // SQL above). Here we prove the RECOMPUTE: with no visible incident rows, the
    // glance flag is false even though a hidden one may exist in the DB.
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;
    state.incidentRows = []; // a moderated-away incident does not reach the loader

    const result = await getBrowseListings(baseInput, NOW);
    expect(result.cards[0]?.glance.hasRecentIncident).toBe(false);
  });

  it("recomputes the recent-incident flag from VISIBLE incidents only — a visible one still flags", async () => {
    // A still-visible recent incident survives the filter → the card flags it,
    // upholding "recent harm is never buried".
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;
    state.incidentRows = [{ listingId: "l1", occurredOn: "2026-06-18" }];

    const result = await getBrowseListings(baseInput, NOW);
    expect(result.cards[0]?.glance.hasRecentIncident).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SQL trust-tier ↔ JS spec equivalence (#114)
//
// The browse sort is SAFETY-CRITICAL: the DB ordering MUST reproduce the exact
// safety tier the card displays (ADR-007). The pure spec lives in
// `safetyTierRank`/`deriveHeadlineSafetyState`; the SQL CASE in `buildOrderBy`
// is the server-side mirror. If the two ever drift, a celiac could be sent to a
// stale/contested listing the product down-ranks — and the existing string
// assertions ("contains case", ">=") would still pass.
//
// So we drive a SHARED case table `(confirms, disputes, lastConfirmedAt)` →
// expected tier and assert BOTH paths produce the SAME tier for every case:
//   - the pure `safetyTierRank` (the spec), and
//   - the SQL CASE, evaluated through a faithful JS mirror of the exact rendered
//     arithmetic. We FIRST pin that rendered structure (so the mirror can't
//     silently diverge from the real SQL), then evaluate the mirror per case.
// A `>` vs `>=`, a flipped confirm/dispute side, or a dropped NULL guard in the
// SQL would break the structural pins; a spec change would break the tier match.
// ---------------------------------------------------------------------------

/**
 * Evaluate the trust-tier CASE the SAME WAY `buildOrderBy` renders it — a
 * faithful JS mirror of the exact SQL arithmetic asserted below. Kept tiny and
 * literal so it can't drift: a coalesce-sum evidence check, a strict
 * confirms-coalesce `>` disputes-coalesce lead, and a `lastConfirmedAt IS NULL
 * OR >= cutoff` freshness test (inclusive edge, NULL = fresh).
 *
 * HONESTY NOTE: this mirror is only trustworthy because the sibling
 * "pins the rendered SQL CASE structure" test (below) asserts the real rendered
 * SQL matches this arithmetic. If that structural-pin test is ever deleted, the
 * equivalence test turns into a tautology (mirror vs mirror) — keep them paired.
 */
function sqlTierFor(
  confirms: number,
  disputes: number,
  lastConfirmedAt: Date | null,
  cutoff: Date
): number {
  const hasEvidence = (confirms ?? 0) + (disputes ?? 0) > 0;
  const confirmsLead = (confirms ?? 0) > (disputes ?? 0);
  const fresh = lastConfirmedAt === null || lastConfirmedAt.getTime() >= cutoff.getTime();
  if (hasEvidence && confirmsLead && fresh) return 4;
  if (hasEvidence && confirmsLead) return 3;
  if (hasEvidence) return 2;
  return 1;
}

describe("trust-tier SQL ↔ JS spec equivalence (#114)", () => {
  // A shared table of evidence shapes spanning every tier and every boundary
  // the CASE branches on (fresh edge, NULL recency, tie, dispute-majority).
  const MONTH = 30 * 24 * 60 * 60 * 1000;
  const cutoff = stalenessCutoff(NOW, DEFAULT_STALENESS_MONTHS);
  const ago = (ms: number) => new Date(NOW.getTime() - ms);
  const windowMs = DEFAULT_STALENESS_MONTHS * MONTH;

  const cases: Array<{
    label: string;
    confirms: number;
    disputes: number;
    lastConfirmedAt: Date | null;
    tier: number;
  }> = [
    // tier 4 — fresh, uncontested confirm-majority (celiac-safe).
    {
      label: "fresh confirm-majority",
      confirms: 8,
      disputes: 1,
      lastConfirmedAt: ago(3 * MONTH),
      tier: 4,
    },
    {
      label: "confirm-majority on the exact staleness edge (inclusive → fresh)",
      confirms: 3,
      disputes: 0,
      lastConfirmedAt: ago(windowMs),
      tier: 4,
    },
    {
      label: "confirm-majority a hair inside the window",
      confirms: 3,
      disputes: 0,
      lastConfirmedAt: ago(windowMs - 1),
      tier: 4,
    },
    {
      label: "confirm-majority with NULL recency (never confirmed = fresh)",
      confirms: 3,
      disputes: 0,
      lastConfirmedAt: null,
      tier: 4,
    },
    // tier 3 — confirm-majority but past the staleness window (stale).
    {
      label: "high-net but stale confirm-majority",
      confirms: 30,
      disputes: 0,
      lastConfirmedAt: ago(2 * 12 * MONTH),
      tier: 3,
    },
    {
      label: "confirm-majority just past the edge (strictly stale)",
      confirms: 5,
      disputes: 1,
      lastConfirmedAt: ago(windowMs + 1),
      tier: 3,
    },
    // tier 2 — contested: disputes tie or outnumber confirms (gluten-friendly).
    {
      label: "tie (contested ≠ affirmed)",
      confirms: 2,
      disputes: 2,
      lastConfirmedAt: ago(1 * MONTH),
      tier: 2,
    },
    {
      label: "big contested (disputes lead despite many confirms)",
      confirms: 18,
      disputes: 20,
      lastConfirmedAt: ago(1 * MONTH),
      tier: 2,
    },
    {
      label: "stale + contested (still tier 2, contested-first)",
      confirms: 1,
      disputes: 10,
      lastConfirmedAt: ago(8 * MONTH),
      tier: 2,
    },
    { label: "dispute-only", confirms: 0, disputes: 4, lastConfirmedAt: null, tier: 2 },
    // tier 1 — no evidence (unattested).
    { label: "no evidence", confirms: 0, disputes: 0, lastConfirmedAt: null, tier: 1 },
  ];

  it("pins the rendered SQL CASE structure the JS mirror reproduces", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;
    await getBrowseListings({ ...baseInput, sort: "trust" }, NOW);

    const tierSql = renderArg(state.orderByArgs[0]);
    // A four-way CASE over the same signals the spec reads.
    expect(tierSql).toContain("case");
    expect(tierSql).toContain("then 4");
    expect(tierSql).toContain("then 3");
    expect(tierSql).toContain("then 2");
    expect(tierSql).toContain("else 1");
    // Evidence = coalesced confirm + dispute > 0 (strict, so 0/0 → no evidence),
    // matching the JS mirror's `hasEvidence`.
    expect(tierSql).toMatch(/coalesce\([^)]*\)\s*\+\s*coalesce\([^)]*\)\s*>\s*0/);
    // Confirms-lead = STRICT `>` between the coalesced confirm and dispute tallies
    // — a `>=` here (a tie reading as affirmed) is exactly the regression the JS
    // mirror's `confirmsLead` would NOT make, so we pin the strict form.
    expect(tierSql).toMatch(/coalesce\([^)]*\)\s*>\s*coalesce\([^)]*\)/);
    // Freshness edge mirrors `isStale`: NULL recency counts as fresh and the
    // lower bound is INCLUSIVE (`>=`), not bare `>` — the JS mirror's `fresh`.
    expect(tierSql).toContain("is null");
    expect(tierSql).toContain(">=");
    expect(tierSql).not.toContain("> $"); // no bare strict `>` against the cutoff param
  });

  it("asserts the SQL tier EQUALS the JS spec tier for every case", () => {
    for (const c of cases) {
      const aggregate = {
        confirmCount: c.confirms,
        disputeCount: c.disputes,
        lastConfirmedAt: c.lastConfirmedAt,
      };
      const sqlTier = sqlTierFor(c.confirms, c.disputes, c.lastConfirmedAt, cutoff);
      const specTier = safetyTierRank(aggregate, NOW, DEFAULT_STALENESS_MONTHS);

      // The case table's expected tier, the SQL mirror, and the pure spec must
      // ALL agree — three independent encodings of the same ADR-007 rule.
      expect(sqlTier, `${c.label}: case-table tier`).toBe(c.tier);
      expect(specTier, `${c.label}: spec vs case-table`).toBe(c.tier);
      expect(sqlTier, `${c.label}: SQL mirror vs spec`).toBe(specTier);
    }
  });

  it("orders a mixed set by SQL tier identically to the JS spec", () => {
    // The whole point of the sort: descending tier puts the safest first. Both
    // the SQL mirror and the pure spec must produce the SAME ordering.
    const byCase = (rankOf: (c: (typeof cases)[number]) => number) =>
      [...cases]
        .sort((a, b) => rankOf(b) - rankOf(a) || a.label.localeCompare(b.label))
        .map((c) => c.label);

    const sqlOrder = byCase((c) => sqlTierFor(c.confirms, c.disputes, c.lastConfirmedAt, cutoff));
    const specOrder = byCase((c) =>
      safetyTierRank(
        { confirmCount: c.confirms, disputeCount: c.disputes, lastConfirmedAt: c.lastConfirmedAt },
        NOW,
        DEFAULT_STALENESS_MONTHS
      )
    );
    expect(sqlOrder).toEqual(specOrder);
  });

  it("keeps the SQL mirror in lockstep with deriveHeadlineSafetyState's tiering", () => {
    // safetyTierRank is a pure function of deriveHeadlineSafetyState; the SQL
    // mirror must land on the SAME tier the displayed headline state maps to.
    const stateToTier: Record<string, number> = {
      "celiac-safe": 4,
      stale: 3,
      "gluten-friendly": 2,
      null: 1,
    };
    for (const c of cases) {
      const headline = deriveHeadlineSafetyState(
        { confirmCount: c.confirms, disputeCount: c.disputes, lastConfirmedAt: c.lastConfirmedAt },
        NOW,
        DEFAULT_STALENESS_MONTHS
      );
      const sqlTier = sqlTierFor(c.confirms, c.disputes, c.lastConfirmedAt, cutoff);
      expect(sqlTier, `${c.label}: SQL tier vs headline state ${String(headline)}`).toBe(
        stateToTier[String(headline)]
      );
    }
  });
});
