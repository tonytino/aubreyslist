import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the browse-list loader.
 *
 * `getBrowseListings` issues a fixed number of batched queries (page of
 * listings LEFT JOINed to a per-listing celiac-trust subquery for ordering, a
 * total count under the same WHERE, one grouped celiac-aggregate query, one
 * incidents query) — no N+1. The mocks model the distinct drizzle chains to
 * assert the assembled cards' trust glance, pagination math, the empty-page
 * short-circuit, the ORDER BY produced per sort, and the WHERE composed from
 * search + taxonomy filter threaded into both the page and count queries —
 * without a live database (docs/agents/testing.md). The exact filter SQL
 * shape is asserted in `filter.test.ts`; here we assert composition (search +
 * filter + sort + paging).
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
    /** The WHERE predicate handed to the celiac-aggregate query (visibility). */
    aggWhere: undefined as unknown,
    /** The WHERE predicate handed to the trust subquery (visibility). */
    subqueryWhere: undefined as unknown,
    /** The WHERE predicate handed to the incidents query (visibility). */
    incidentWhere: undefined as unknown,
    /** Rows returned by the bot-suggested-attribute query. */
    suggestionRows: [] as Array<Record<string, unknown>>,
    /** The WHERE predicate handed to the bot-suggestion query (visibility). */
    suggestionWhere: undefined as unknown,
    /** Rows returned by the confirmed non-headline attribute query. */
    confirmedRows: [] as Array<Record<string, unknown>>,
    /** The WHERE predicate handed to the confirmed-attribute query. */
    confirmedWhere: undefined as unknown,
    /** Public per-listing save counts returned by the (mocked) favorites layer. */
    favoriteCounts: new Map<string, number>(),
    /** The listing ids passed to `getFavoriteCounts` (asserted batched, not N+1). */
    favoriteCountIds: undefined as string[] | undefined,
    /**
     * The viewer's visible favorite ids returned by the (mocked)
     * `getViewerFavoriteIds` — drives the `savedOnly` path. `[]` models both
     * an anonymous caller and a signed-in user with no favorites.
     */
    viewerFavoriteIds: [] as string[],
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

  // The bot-suggestion existence chain: select(proj).from().where()
  const suggestionWhereMock = vi.fn((predicate?: unknown) => {
    state.suggestionWhere = predicate;
    return Promise.resolve(state.suggestionRows);
  });
  const suggestionFromMock = vi.fn(() => ({ where: suggestionWhereMock }));
  // The suggestion chain routes by the `suggestedListingId` projection key
  // and carries a `suggestedAttribute` per row.

  // The confirmed-attribute consensus chain:
  //   select(proj).from().leftJoin().where().groupBy().having()  (awaited)
  // Routed by its own `confirmedListingId` projection key so it never falls into
  // the call-order-branched `celiacFromMock` (whose leftJoin counter distinguishes
  // the trust subquery from the aggregate query).
  const confirmedHavingMock = vi.fn(() => Promise.resolve(state.confirmedRows));
  const confirmedGroupByMock = vi.fn(() => ({ having: confirmedHavingMock }));
  const confirmedWhereMock = vi.fn((predicate?: unknown) => {
    state.confirmedWhere = predicate;
    return { groupBy: confirmedGroupByMock };
  });
  const confirmedLeftJoinMock = vi.fn(() => ({ where: confirmedWhereMock }));
  const confirmedFromMock = vi.fn(() => ({ leftJoin: confirmedLeftJoinMock }));

  // The count chain: select({ total }).from().where()  (awaited)
  const countWhereMock = vi.fn((predicate?: unknown) => {
    state.countWhere = predicate;
    return Promise.resolve([{ total: state.total }]);
  });
  const countFromMock = vi.fn(() => ({ where: countWhereMock }));

  // Route each query to the right chain by its select() projection:
  //  - { listing }               → page listings (joined to the trust subquery)
  //  - { total }                 → count
  //  - has `occurredOn`          → incidents
  //  - has `suggestedListingId`  → bot-suggestion existence
  //  - has `confirmedListingId`  → confirmed non-headline consensus
  //  - otherwise (claim cols)    → celiac aggregate / trust subquery
  const selectMock = vi.fn((projection?: Record<string, unknown>) => {
    if (projection && "listing" in projection) return { from: pageFromMock };
    if (projection && "total" in projection) return { from: countFromMock };
    if (projection && "occurredOn" in projection) return { from: incidentFromMock };
    if (projection && "suggestedListingId" in projection) return { from: suggestionFromMock };
    if (projection && "confirmedListingId" in projection) return { from: confirmedFromMock };
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

// The public save-count aggregate is a separate server-only helper
// (`~/server/favorites`) that `getBrowseListings` batches alongside the trust
// signals. Stubbed here so this loader test stays focused on the loader's
// composition/attachment (the aggregate's own SQL is pinned in the favorites
// tests); the ids are captured to assert the call is batched (one call, all
// ids).
vi.mock("~/server/favorites/index", () => ({
  getFavoriteCounts: (listingIds: string[]) => {
    h.state.favoriteCountIds = listingIds;
    return Promise.resolve(h.state.favoriteCounts);
  },
  // The `savedOnly` path resolves the viewer's visible favorite ids here.
  // `[]` (anonymous or empty favorites) must short-circuit to an empty page.
  getViewerFavoriteIds: () => Promise.resolve(h.state.viewerFavoriteIds),
}));

import { UNION_STATION } from "~/listings/distance";
import { parseQuick } from "~/listings/quick";
import { formatFreshness } from "~/trust/browse-card-format";
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
  state.suggestionRows = [];
  state.suggestionWhere = undefined;
  state.confirmedRows = [];
  state.confirmedWhere = undefined;
  state.favoriteCounts = new Map();
  state.favoriteCountIds = undefined;
  state.viewerFavoriteIds = [];
  h.resetCallCounters();
});

afterEach(() => {
  vi.clearAllMocks();
});

const baseInput: BrowseListingsInput = {
  page: 1,
  pageSize: 20,
  q: "",
  attrs: [],
  sort: "alpha",
  savedOnly: false,
  quick: [],
  includeSuggested: true,
};

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

  it("flags suggestedByBot (with its attribute set) for a listing whose only bot suggestion is non-celiac (AUB-193)", async () => {
    state.pageListings = [{ id: "l1", name: "Seeded Spot", address: "5 Main St" }];
    state.total = 1;
    state.celiacRows = []; // no celiac claim — the bot suggested only other attributes
    state.suggestionRows = [{ suggestedListingId: "l1", suggestedAttribute: "dedicated_fryer" }];

    const result = await getBrowseListings(baseInput, NOW);

    expect(result.cards[0]?.glance.safetyState).toBeNull();
    expect(result.cards[0]?.glance.suggestedByBot).toBe(true);
    expect(result.cards[0]?.glance.suggestedAttributes).toEqual(["dedicated_fryer"]);
  });

  it("keeps suggestedByBot true once real celiac evidence exists — provenance is not gated (owner nit 7)", async () => {
    state.pageListings = [{ id: "l1", name: "Voted Spot", address: "6 Main St" }];
    state.total = 1;
    state.celiacRows = [
      {
        listingId: "l1",
        claimId: "c1",
        lastConfirmedAt: new Date("2026-06-20T00:00:00Z"),
        confirmCount: "3",
        disputeCount: "0",
        contributors: "3",
      },
    ];
    state.suggestionRows = [{ suggestedListingId: "l1", suggestedAttribute: "gf_substitutes" }];

    const result = await getBrowseListings(baseInput, NOW);

    // The verdict/evidence derive from evidence only; the live suggestion keeps
    // the provenance label + badge data alongside them (never altering them).
    expect(result.cards[0]?.glance.safetyState).toBe("celiac-safe");
    expect(result.cards[0]?.glance.suggestedByBot).toBe(true);
    expect(result.cards[0]?.glance.suggestedAttributes).toEqual(["gf_substitutes"]);
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

  // --- Sort ordering ----------------------------------------------------------

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
    // Safety-critical: the displayed safety tier (a CASE over confirm/dispute
    // + staleness) leads — not raw net confirms — so a stale/contested
    // listing can't outrank a fresh celiac-safe one. Desc = safest first.
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

    // The trust tier CASE is the first ORDER BY term. Its `fresh` predicate
    // must mirror `isStale` exactly: an inclusive lower bound (`>=`, so an
    // exact-edge confirmation is fresh, not flipped to stale) and null
    // lastConfirmedAt counted as fresh (a never-confirmed confirm-majority is
    // celiac-safe, not stale — ADR-007), not bare `>` which would drift from
    // the displayed card.
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

  // --- "Near me" distance sort ------------------------------------------------

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

  it("degrades distance sort to recency when NO location is available at all", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    // sort=distance, no browser reading and no coarse request anchor.
    await getBrowseListings({ ...baseInput, sort: "distance" }, NOW);

    // The recency ORDER BY: last-confirmed first, then net consensus, then
    // name — not the single-term alphabetical order.
    expect(state.orderByArgs).toHaveLength(3);
    expect(renderArg(state.orderByArgs[0])).toContain("desc");
    expect(renderArg(state.orderByArgs[2])).toContain('"name"');
  });

  it("degrades distance sort when only HALF a coordinate pair is supplied", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    // A lone lat (no lng) is meaningless for distance → fall back, don't error.
    await getBrowseListings({ ...baseInput, sort: "distance", userLat: 39.7392 }, NOW);

    expect(state.orderByArgs).toHaveLength(3);
    expect(renderArg(state.orderByArgs[2])).toContain('"name"');
  });

  it("anchors the distance sort on the coarse request location when the browser sent none", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, sort: "distance" }, NOW, undefined, {
      lat: 39.7392,
      lng: -104.9903,
    });

    // A real distance ORDER BY, from the request anchor.
    expect(state.orderByArgs).toHaveLength(2);
    const params = dialect.sqlToQuery(state.orderByArgs[0] as SQL).params;
    expect(params).toContain(39.7392);
    expect(params).toContain(-104.9903);
  });

  it("prefers the browser reading over the coarse request location", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings(
      { ...baseInput, sort: "distance", userLat: 40.5, userLng: -105.5 },
      NOW,
      undefined,
      { lat: 39.7392, lng: -104.9903 }
    );

    const params = dialect.sqlToQuery(state.orderByArgs[0] as SQL).params;
    expect(params).toContain(40.5);
    expect(params).not.toContain(39.7392);
  });

  it("reports a browser reading as the precise anchor", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    const result = await getBrowseListings(
      { ...baseInput, sort: "distance", userLat: 39.7392, userLng: -104.9903 },
      NOW
    );
    expect(result).toMatchObject({
      sort: "distance",
      effectiveSort: "distance",
      locationSource: "precise",
    });
  });

  it("labels no distance when only the coarse request anchor is available", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    const result = await getBrowseListings({ ...baseInput, sort: "distance" }, NOW, undefined, {
      lat: 39.74,
      lng: -104.99,
    });

    // The list is ordered from the coarse anchor, but no card claims a
    // precise "0.4 mi" the anchor cannot support.
    expect(state.orderByArgs).toHaveLength(2);
    expect(result.cards[0]?.distanceLabel).toBeUndefined();
  });

  it("reports a request-header anchor as coarse", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    const result = await getBrowseListings({ ...baseInput, sort: "distance" }, NOW, undefined, {
      lat: 39.74,
      lng: -104.99,
    });
    expect(result).toMatchObject({ effectiveSort: "distance", locationSource: "coarse" });
  });

  it("keeps the requested sort but reports the order it really used", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    // Nothing to anchor on: the response still echoes the visitor's selection,
    // so the control stays where they put it, while `effectiveSort` tells the
    // page what it is actually showing.
    const result = await getBrowseListings({ ...baseInput, sort: "distance" }, NOW);
    expect(result).toMatchObject({
      sort: "distance",
      effectiveSort: "recency",
      locationSource: "none",
    });
  });

  it("reports no location source for a sort that never needed one", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    const result = await getBrowseListings({ ...baseInput, sort: "trust" }, NOW);
    expect(result).toMatchObject({ sort: "trust", effectiveSort: "trust", locationSource: "none" });
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

  // --- Public, user-agnostic save-count attachment ----------------------------

  it("attaches the public favorite count to each card from the batched aggregate", async () => {
    state.pageListings = [
      { id: "l1", name: "A", address: "a" },
      { id: "l2", name: "B", address: "b" },
    ];
    state.total = 2;
    state.favoriteCounts = new Map([
      ["l1", 12],
      ["l2", 3],
    ]);

    const result = await getBrowseListings(baseInput, NOW);

    expect(result.cards[0]?.favoriteCount).toBe(12);
    expect(result.cards[1]?.favoriteCount).toBe(3);
    // Batched (no N+1): the count helper is called once with all page listing ids.
    expect(state.favoriteCountIds).toEqual(["l1", "l2"]);
  });

  it("defaults the favorite count to 0 for a listing absent from the aggregate", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;
    // No entry for l1 → it has no favorites → the card reports 0 (never undefined).
    state.favoriteCounts = new Map();

    const result = await getBrowseListings(baseInput, NOW);

    expect(result.cards[0]?.favoriteCount).toBe(0);
  });

  it("attaches BOTH the save count and the distance label when distance-sorting", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a", distanceKm: 0.643_738 }];
    state.total = 1;
    state.favoriteCounts = new Map([["l1", 7]]);

    const result = await getBrowseListings(
      { ...baseInput, sort: "distance", userLat: 39.7392, userLng: -104.9903 },
      NOW
    );

    expect(result.cards[0]?.favoriteCount).toBe(7);
    expect(result.cards[0]?.distanceLabel).toBe("0.4 mi");
  });

  // --- WHERE composition (search + taxonomy filter) ---------------------------

  it("always constrains to visible listings even when no attrs/search are given (#41)", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings(baseInput, NOW);

    // No search term + no attributes: the only constraint is the visibility
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

  // --- includeSuggested threading ---------------------------------------------
  // Pins that `getBrowseListings` actually threads `input.includeSuggested`
  // into both predicate builders — dropping the argument at either call site
  // in browse.ts would silently turn `?bot=false` into a no-op while every
  // builder-level test stayed green. `?bot=false` has two effects: it strips
  // the live-suggestion OR-branch from filter matching, and it folds the
  // bot-suggested-only result-set exclusion (the chip must actually hide the
  // "Suggested by Aubrey's Bot" cards) into the shared WHERE.

  it("threads includeSuggested=true (the default) into the taxonomy AND quick filter SQL", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, attrs: ["dedicated_fryer"], quick: ["celiac"] }, NOW);

    // One shared WHERE for page + count, carrying the live-suggestion OR-branch
    // in BOTH the taxonomy predicate and the quick=celiac predicate.
    expect(state.pageWhere).toBeDefined();
    expect(state.countWhere).toBe(state.pageWhere);
    const sql = renderArg(state.pageWhere);
    // One live-suggestion OR-branch per predicate (taxonomy + quick=celiac).
    // Match the HAVING's `suggested_by" is not null` specifically — each
    // subquery also names the column once in its GROUP BY.
    expect((sql.match(/suggested_by" is not null/g) ?? []).length).toBe(2);
  });

  it("includeSuggested=false strips the suggestion branch from filter matching AND adds the exclusion", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings(
      { ...baseInput, attrs: ["dedicated_fryer"], quick: ["celiac"], includeSuggested: false },
      NOW
    );

    expect(state.pageWhere).toBeDefined();
    expect(state.countWhere).toBe(state.pageWhere);
    const sql = renderArg(state.pageWhere);
    // Matching is community-evidence-only: neither the taxonomy EXISTS nor the
    // quick=celiac EXISTS carries a live-suggestion OR-branch anymore. The ONE
    // remaining `suggested_by` reference is the result-set exclusion's
    // live-suggestion branch.
    expect((sql.match(/suggested_by/g) ?? []).length).toBe(1);
    // The bot-suggested-only exclusion: NOT (live-suggestion EXISTS AND NOT
    // any-evidence EXISTS) — see filter.test.ts for its exact shape.
    expect(sql).toContain("not (exists");
    expect(sql).toContain('inner join "attestations"');
  });

  it("includeSuggested=false EXCLUDES bot-suggested-only listings from page AND count even with NO other filter (the owner bug)", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    // Nothing else active — no q, attrs, quick, radius, saved. The exclusion
    // must still constrain, or the chip is a visible no-op.
    await getBrowseListings({ ...baseInput, includeSuggested: false }, NOW);

    expect(state.pageWhere).toBeDefined();
    // The SAME predicate object constrains the page and the count query, so the
    // total/hasMore honestly reflect the exclusion (pagination stays correct).
    expect(state.countWhere).toBe(state.pageWhere);
    const sql = renderArg(state.pageWhere);
    // Visibility still applies…
    expect(sql).toContain("moderation_status");
    // …and the exclusion is present: a live suggestion with no community
    // evidence anywhere means the listing is dropped from the result set.
    expect(sql).toContain("not (exists");
    expect(sql).toContain("suggested_by");
    expect(sql).toContain("and not exists");
    expect(sql).toContain('inner join "attestations"');
    // Pin the full correlated equality, not just the joined table name — an
    // edit that aliased the outer `claims` table (breaking the correlation)
    // would still render `inner join "attestations"` and pass the looser
    // check, but must not silently change which rows the subquery joins.
    expect(sql).toContain('"attestations"."claim_id" = "claims"."id"');
  });

  it("default (includeSuggested=true) folds NO exclusion into the WHERE — behavior unchanged", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings(baseInput, NOW);

    // A bare default browse: only the visibility predicate — no correlated
    // EXISTS, no `suggested_by` anywhere.
    const sql = renderArg(state.pageWhere);
    expect(sql).not.toContain("exists");
    expect(sql).not.toContain("suggested_by");
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
        attrs: ["dedicated_fryer", "celiac_safe"],
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

    // A blank search adds no text constraint, but the public read still
    // excludes hidden/removed listings.
    expect(state.pageWhere).toBeDefined();
    expect(state.countWhere).toBe(state.pageWhere);
    expect(dialect.sqlToQuery(state.pageWhere as SQL).params).toContain("visible");
  });

  // --- Distance-radius filter -------------------------------------------------

  it("folds the radius predicate into the SHARED where (page AND count) so total is honest", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings(
      { ...baseInput, radiusMiles: 5, originLat: 39.7539, originLng: -104.9999 },
      NOW
    );

    // The radius constraint applies to BOTH the page and count queries via the
    // SAME predicate object, so the total reflects the radius (count-honesty).
    expect(state.pageWhere).toBeDefined();
    expect(state.countWhere).toBe(state.pageWhere);

    const rendered = dialect.sqlToQuery(state.pageWhere as SQL);
    const sql = rendered.sql.toLowerCase();
    // The predicate is the great-circle km expression (haversine over radians)
    // compared to the radius, INCLUSIVE (`<=`).
    expect(sql).toContain("radians");
    expect(sql).toContain("asin");
    expect(sql).toContain("<=");
    // The origin coords are bound as params (never hardcoded into the SQL).
    expect(rendered.params).toContain(39.7539);
    expect(rendered.params).toContain(-104.9999);
    // The comparison bound is the radius converted to KM (5 mi × 1.609344).
    expect(rendered.params).toContain(5 * 1.609344);
    // Still constrained to visible listings.
    expect(rendered.params).toContain("visible");
  });

  it("uses an inclusive boundary (<= radius-km) so a listing exactly on the radius is kept", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings(
      { ...baseInput, radiusMiles: 10, originLat: 39.7539, originLng: -104.9999 },
      NOW
    );

    const rendered = dialect.sqlToQuery(state.pageWhere as SQL);
    // Inclusive `<=` (not `<`), and the bound is exactly 10 mi in km.
    expect(rendered.sql.toLowerCase()).toContain("<=");
    expect(rendered.sql).not.toContain("< $"); // no bare strict `<` against the radius bound
    expect(rendered.params).toContain(10 * 1.609344);
  });

  it("composes the radius filter WITH search + taxonomy filter in one shared where", async () => {
    state.pageListings = [{ id: "l1", name: "Taco House", address: "1 Main St" }];
    state.total = 1;

    await getBrowseListings(
      {
        ...baseInput,
        q: "taco",
        attrs: ["dedicated_fryer"],
        radiusMiles: 15,
        originLat: 39.7539,
        originLng: -104.9999,
      },
      NOW
    );

    expect(state.pageWhere).toBeDefined();
    expect(state.countWhere).toBe(state.pageWhere);
    const rendered = dialect.sqlToQuery(state.pageWhere as SQL);
    // Search term + radius bound both live in the single composed predicate.
    expect(rendered.params).toContain("%taco%");
    expect(rendered.params).toContain(15 * 1.609344);
  });

  it("applies NO radius constraint when radiusMiles is absent (unchanged behavior)", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    // Origin present but no radius → no distance filter.
    await getBrowseListings({ ...baseInput, originLat: 39.7539, originLng: -104.9999 }, NOW);

    const sql = renderArg(state.pageWhere);
    // Only the visibility predicate; no haversine distance comparison.
    expect(sql).not.toContain("radians");
    expect(sql).toContain("moderation_status");
  });

  it("anchors the radius on the fallback when the origin is incomplete (half a pair)", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    // A radius with only originLat (no originLng) can't anchor itself, so it
    // falls back like a missing origin — a "Within 5 mi" chip always filters
    // by 5 miles of somewhere, never silently by nothing.
    await getBrowseListings({ ...baseInput, radiusMiles: 5, originLat: 39.7539 }, NOW);

    const sql = renderArg(state.pageWhere);
    expect(sql).toContain("radians");
    expect(sql).toContain("moderation_status");
  });

  it("anchors the radius on Union Station when no origin and no location are known", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, radiusMiles: 5 }, NOW);

    const params = dialect.sqlToQuery(state.pageWhere as SQL).params;
    expect(params).toContain(UNION_STATION.lat);
    expect(params).toContain(UNION_STATION.lng);
  });

  it("anchors the radius on the coarse request location before Union Station", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, radiusMiles: 5 }, NOW, undefined, {
      lat: 40.015,
      lng: -105.27,
    });

    const params = dialect.sqlToQuery(state.pageWhere as SQL).params;
    expect(params).toContain(40.015);
    expect(params).not.toContain(UNION_STATION.lat);
  });

  it("keeps the radius filter INDEPENDENT of the near-me sort coords", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    // A radius origin but NO userLat/userLng and a non-distance sort: the radius
    // still filters (WHERE), while the sort stays alphabetical (ORDER BY).
    await getBrowseListings(
      { ...baseInput, sort: "alpha", radiusMiles: 5, originLat: 39.7539, originLng: -104.9999 },
      NOW
    );

    expect(renderArg(state.pageWhere)).toContain("radians"); // radius filter active
    expect(state.orderByArgs).toHaveLength(1); // alphabetical order, not distance
    expect(renderArg(state.orderByArgs[0])).toContain('"name"');
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
      {
        page: 2,
        pageSize: 2,
        q: "taco",
        attrs: ["dedicated_fryer"],
        sort: "trust",
        savedOnly: false,
        quick: [],
        includeSuggested: true,
      },
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
// Server-side "Saved" filter (savedOnly)
//
// The Saved filter must be server-side so pagination and the honest total
// cover the full favorites set, not a client-side slice of the loaded page.
// `savedOnly` folds `listings.id IN (viewer favorite ids)` into the shared
// where — applied to the page and count queries before paginating — and
// short-circuits an anonymous/empty caller to an empty page without a broad
// (unconstrained) query.
// ---------------------------------------------------------------------------
describe("getBrowseListings — savedOnly (F11)", () => {
  const FIVE_FAVES = ["l1", "l2", "l3", "l4", "l5"];

  it("constrains BOTH the page and count queries to the viewer's favorite ids (folded into the shared WHERE)", async () => {
    state.viewerFavoriteIds = FIVE_FAVES;
    state.pageListings = [
      { id: "l1", name: "A", address: "a" },
      { id: "l2", name: "B", address: "b" },
    ];
    state.total = 5;

    await getBrowseListings({ ...baseInput, savedOnly: true, pageSize: 2 }, NOW);

    // The same predicate object constrains the page and the count query, so
    // the total is honest over the favorites subset.
    expect(state.pageWhere).toBeDefined();
    expect(state.countWhere).toBe(state.pageWhere);

    const rendered = dialect.sqlToQuery(state.pageWhere as SQL);
    // `listings.id IN (...)` over the viewer's favorite ids, still AND-folded
    // with the visibility predicate.
    expect(rendered.sql.toLowerCase()).toContain(" in (");
    expect(rendered.params).toContain("visible");
    for (const id of FIVE_FAVES) {
      expect(rendered.params).toContain(id);
    }
  });

  it("keeps total honest over the FULL favorites set and paginates correctly (page 1 of 3)", async () => {
    // 5 favorites, pageSize 2 → page 1 holds the first 2, and hasMore is true
    // because the honest total (5) exceeds offset+rows (0+2).
    state.viewerFavoriteIds = FIVE_FAVES;
    state.pageListings = [
      { id: "l1", name: "A", address: "a" },
      { id: "l2", name: "B", address: "b" },
    ];
    state.total = 5;

    const result = await getBrowseListings({ ...baseInput, savedOnly: true, pageSize: 2 }, NOW);

    expect(result.total).toBe(5);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(result.cards.map((c) => c.listing.id)).toEqual(["l1", "l2"]);
  });

  it("reports hasMore=false on the last page of the favorites set (page 3 of 3)", async () => {
    // Offset 4 + the 1 trailing row = 5 = total → no further page.
    state.viewerFavoriteIds = FIVE_FAVES;
    state.pageListings = [{ id: "l5", name: "E", address: "e" }];
    state.total = 5;

    const result = await getBrowseListings(
      { ...baseInput, savedOnly: true, page: 3, pageSize: 2 },
      NOW
    );

    expect(result.total).toBe(5);
    expect(result.page).toBe(3);
    expect(result.hasMore).toBe(false);
    expect(result.cards.map((c) => c.listing.id)).toEqual(["l5"]);
  });

  it("ANONYMOUS/EMPTY favorites → empty page with total 0 and NO query at all (no broad read)", async () => {
    // getViewerFavoriteIds() returns [] for an anonymous caller AND a signed-in
    // user with no visible favorites; both must short-circuit to an empty page
    // WITHOUT ever issuing a query.
    state.viewerFavoriteIds = [];
    state.pageListings = [{ id: "l1", name: "A", address: "a" }]; // would be returned by a broad read
    state.total = 999;

    const result = await getBrowseListings({ ...baseInput, savedOnly: true }, NOW);

    expect(result.cards).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
    // Proof there was no broad query: no select() ran, so neither the page
    // nor the count WHERE was ever built.
    expect(h.selectMock).not.toHaveBeenCalled();
    expect(state.pageWhere).toBeUndefined();
    expect(state.countWhere).toBeUndefined();
  });

  it("does NOT constrain by favorites when savedOnly is false (unchanged behavior)", async () => {
    // A signed-in viewer with favorites, but savedOnly off — the normal
    // browse: getViewerFavoriteIds is never consulted and the WHERE has no
    // id IN (...).
    state.viewerFavoriteIds = FIVE_FAVES;
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, savedOnly: false }, NOW);

    const sql = renderArg(state.pageWhere);
    expect(sql).not.toContain(" in (");
    expect(sql).toContain("moderation_status");
  });
});

// ---------------------------------------------------------------------------
// Every browse signal query excludes non-visible content + recomputes
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
    // moderated-away incident never flags the card — but a still-visible one
    // always does ("recent harm is never buried").
    expect(renderArg(state.incidentWhere)).toContain("moderation_status");
    expect(dialect.sqlToQuery(state.incidentWhere as SQL).params).toContain("visible");

    // The bot-suggested-attribute check counts only visible claims with a
    // live `suggested_by`, so a hidden/removed suggested claim can never
    // drive the "Suggested by Aubrey's Bot" cue.
    expect(renderArg(state.suggestionWhere)).toContain("moderation_status");
    expect(renderArg(state.suggestionWhere)).toContain("suggested_by");
    expect(renderArg(state.suggestionWhere)).toContain("is not null");
    expect(dialect.sqlToQuery(state.suggestionWhere as SQL).params).toContain("visible");
    // ...and only unvoted claims (the correlated NOT EXISTS attestations vote
    // gate): castVote's clear of `suggested_by` is not atomic with the
    // attestation upsert, so a transiently-stale suggestion on a voted claim
    // must never badge the card as suggested (ADR-007, belt-and-braces).
    expect(renderArg(state.suggestionWhere)).toContain("not exists");
    expect(renderArg(state.suggestionWhere)).toContain("attestations");
  });

  it("recomputes the recent-incident flag from VISIBLE incidents only — none survive → no flag", async () => {
    // The browse incidents query excludes hidden incidents at the DB
    // (asserted in SQL above). Here we prove the recompute: with no visible
    // incident rows, the glance flag is false even though a hidden one may
    // exist in the DB.
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;
    state.incidentRows = []; // a moderated-away incident does not reach the loader

    const result = await getBrowseListings(baseInput, NOW);
    expect(result.cards[0]?.glance.hasRecentIncident).toBe(false);
  });

  it("recomputes the recent-incident flag from VISIBLE incidents only — a visible one still flags", async () => {
    // A still-visible recent incident survives the filter, so the card flags
    // it — "recent harm is never buried".
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;
    state.incidentRows = [{ listingId: "l1", occurredOn: "2026-06-18" }];

    const result = await getBrowseListings(baseInput, NOW);
    expect(result.cards[0]?.glance.hasRecentIncident).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SQL trust-tier ↔ JS spec equivalence
//
// The browse sort is safety-critical: the DB ordering must reproduce the
// exact safety tier the card displays (ADR-007). The pure spec lives in
// `safetyTierRank`/`deriveHeadlineSafetyState`; the SQL CASE in
// `buildOrderBy` is the server-side mirror. If the two ever drift, a celiac
// could be sent to a stale/contested listing the product down-ranks — and
// bare string assertions ("contains case", ">=") would still pass.
//
// So a shared case table `(confirms, disputes, lastConfirmedAt)` → expected
// tier drives both paths, which must produce the same tier for every case:
//   - the pure `safetyTierRank` (the spec), and
//   - the SQL CASE, evaluated through a faithful JS mirror of the exact
//     rendered arithmetic. The rendered structure is pinned first (so the
//     mirror can't silently diverge from the real SQL), then the mirror is
//     evaluated per case.
// A `>` vs `>=`, a flipped confirm/dispute side, or a dropped null guard in
// the SQL breaks the structural pins; a spec change breaks the tier match.
// ---------------------------------------------------------------------------

/**
 * Evaluate the trust-tier CASE the SAME WAY `buildOrderBy` renders it — a
 * faithful JS mirror of the exact SQL arithmetic asserted below. Kept tiny
 * and literal so it can't drift: a coalesce-sum evidence check, a strict
 * confirms-coalesce `>` disputes-coalesce lead, and a `lastConfirmedAt IS
 * NULL OR >= cutoff` freshness test (inclusive edge, null = fresh).
 *
 * Three branches (4 / 3 / else 1): contested evidence falls through to the
 * same bottom tier as no evidence at all, because both display no badge. Tier
 * 2 is deliberately vacant so the SQL mirror stays diffable.
 *
 * This mirror is only trustworthy because the sibling "pins the rendered SQL
 * CASE structure" test asserts the real rendered SQL matches this arithmetic.
 * Deleting that structural-pin test turns the equivalence test into a
 * tautology (mirror vs mirror) — keep them paired.
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
    // tier 1 — no badge: contested (disputes tie or outnumber confirms) OR
    // unattested. One tier for both: they render the same glance, so the sort
    // must not claim to tell them apart. Tier 2 is vacant.
    {
      label: "tie (contested ≠ affirmed)",
      confirms: 2,
      disputes: 2,
      lastConfirmedAt: ago(1 * MONTH),
      tier: 1,
    },
    {
      label: "big contested (disputes lead despite many confirms)",
      confirms: 18,
      disputes: 20,
      lastConfirmedAt: ago(1 * MONTH),
      tier: 1,
    },
    {
      label: "stale + contested (contested-first, never a neutral stale chip)",
      confirms: 1,
      disputes: 10,
      lastConfirmedAt: ago(8 * MONTH),
      tier: 1,
    },
    { label: "dispute-only", confirms: 0, disputes: 4, lastConfirmedAt: null, tier: 1 },
    { label: "no evidence", confirms: 0, disputes: 0, lastConfirmedAt: null, tier: 1 },
  ];

  it("pins the rendered SQL CASE structure the JS mirror reproduces", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "a" }];
    state.total = 1;
    await getBrowseListings({ ...baseInput, sort: "trust" }, NOW);

    const tierSql = renderArg(state.orderByArgs[0]);
    // A three-way CASE over the same signals the spec reads.
    expect(tierSql).toContain("case");
    expect(tierSql).toContain("then 4");
    expect(tierSql).toContain("then 3");
    expect(tierSql).toContain("else 1");
    // Tier 2 is deliberately vacant: a "contested" rank would mean the sort
    // distinguishes a disputed listing from an unattested one, which the
    // displayed glance deliberately does not.
    expect(tierSql).not.toContain("then 2");
    // Evidence = coalesced confirm + dispute > 0 (strict, so 0/0 → no evidence),
    // matching the JS mirror's `hasEvidence`.
    expect(tierSql).toMatch(/coalesce\([^)]*\)\s*\+\s*coalesce\([^)]*\)\s*>\s*0/);
    // Confirms-lead = strict `>` between the coalesced confirm and dispute
    // tallies — a `>=` here (a tie reading as affirmed) is exactly the
    // regression the JS mirror's `confirmsLead` would not make, so the strict
    // form is pinned.
    expect(tierSql).toMatch(/coalesce\([^)]*\)\s*>\s*coalesce\([^)]*\)/);
    // Freshness edge mirrors `isStale`: null recency counts as fresh and the
    // lower bound is inclusive (`>=`), not bare `>` — the JS mirror's `fresh`.
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

      // The case table's expected tier, the SQL mirror, and the pure spec
      // must all agree — three independent encodings of the same ADR-007 rule.
      expect(sqlTier, `${c.label}: case-table tier`).toBe(c.tier);
      expect(specTier, `${c.label}: spec vs case-table`).toBe(c.tier);
      expect(sqlTier, `${c.label}: SQL mirror vs spec`).toBe(specTier);
    }
  });

  it("orders a mixed set by SQL tier identically to the JS spec", () => {
    // The whole point of the sort: descending tier puts the safest first.
    // Both the SQL mirror and the pure spec must produce the same ordering.
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
      null: 1, // no badge — contested and unattested alike
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

// ---------------------------------------------------------------------------
// Quick filter — composition + glance-spec equivalence
// ---------------------------------------------------------------------------

/**
 * Faithful JS mirrors of the correlated `quick` predicates in
 * `./quick-filter.ts`, kept tiny and literal so they can't drift from the
 * SQL. Their exact SQL rendering (strict `>`, `>=` cutoff, `not exists`
 * incident window) is pinned structurally in `quick-filter.test.ts`; here we
 * prove that same boolean logic lands on the same row the displayed glance
 * shows — a `quick` filter can never surface a listing whose card reads
 * differently (ADR-007).
 *
 * There is no `friendly` mirror: the token is not in the vocabulary.
 */
function quickCeliacMatches(
  confirms: number,
  disputes: number,
  lastConfirmedAt: Date | null,
  cutoff: Date
): boolean {
  const hasEvidence = confirms + disputes > 0;
  const confirmsLead = confirms > disputes;
  const fresh = lastConfirmedAt === null || lastConfirmedAt.getTime() >= cutoff.getTime();
  return hasEvidence && confirmsLead && fresh;
}
function quickRecentMatches(
  lastConfirmedAt: Date | null,
  cutoff: Date,
  recentIncidentAt: Date | null
): boolean {
  const freshConfirmation =
    lastConfirmedAt !== null && lastConfirmedAt.getTime() >= cutoff.getTime();
  return freshConfirmation && recentIncidentAt === null;
}

describe("quick filter composition (AUB-135)", () => {
  it("AND-folds the quick predicate into BOTH the page and count WHERE (honest total)", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "1 St" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, quick: ["celiac"] }, NOW);

    const pageWhere = renderArg(state.pageWhere);
    const countWhere = renderArg(state.countWhere);
    expect(pageWhere).toContain("exists");
    // The same predicate constrains the page and the count, so the total
    // honestly reflects the filter (no fetch-then-filter).
    expect(countWhere).toBe(pageWhere);
  });

  it("applies NO quick constraint when no chip is active", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "1 St" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput }, NOW);

    // Only the visibility predicate — no correlated EXISTS from a quick filter.
    expect(renderArg(state.pageWhere)).not.toContain("exists");
  });

  // One `getBrowseListings` call per test — the mock's leftJoin call-counter
  // (trust subquery vs celiac aggregate) only resets in `beforeEach`.
  it("celiac encodes the strict confirms > disputes direction (a tie never matches)", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "1 St" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, quick: ["celiac"] }, NOW);

    const where = renderArg(state.pageWhere);
    expect(where).toMatch(/'confirm'\)\s*>\s*count\(\*\)\s*filter/);
    // No contested `<=` direction may appear anywhere in the browse WHERE:
    // that reading has no token and no SQL.
    expect(where).not.toMatch(/'confirm'\)\s*<=\s*count\(\*\)\s*filter/);
  });

  it("degrades an old ?quick=friendly link to an UNFILTERED page (never a silent re-reading)", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "1 St" }];
    state.total = 1;

    // An old shared link. `parseQuick` already drops the token, so the
    // loader hands `getBrowseListings` an empty selection; this pins that the
    // browse layer then applies no quick constraint at all rather than
    // erroring or falling back to some other safety filter.
    await getBrowseListings({ ...baseInput, quick: parseQuick("friendly") }, NOW);

    expect(renderArg(state.pageWhere)).not.toContain("exists");
  });

  it("recent adds a NOT EXISTS recent-incident window", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "1 St" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, quick: ["recent"] }, NOW);

    const recentWhere = renderArg(state.pageWhere);
    expect(recentWhere).toContain("not exists");
    expect(recentWhere).toContain("occurred_on");
  });

  it("composes (AND) with the taxonomy filter and search", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "1 St" }];
    state.total = 1;

    await getBrowseListings(
      { ...baseInput, quick: ["celiac"], attrs: ["dedicated_fryer"], q: "taco" },
      NOW
    );

    const composed = renderArg(state.pageWhere);
    expect(composed).toContain("ilike"); // search
    expect(composed.match(/exists/g)?.length ?? 0).toBeGreaterThanOrEqual(2); // taxonomy + quick
  });

  it("AND-composes a multi-token set into the SAME page + count WHERE (AUB-140)", async () => {
    state.pageListings = [{ id: "l1", name: "A", address: "1 St" }];
    state.total = 1;

    await getBrowseListings({ ...baseInput, quick: ["celiac", "recent"] }, NOW);

    const pageWhere = renderArg(state.pageWhere);
    // Both facets present — celiac's EXISTS and recent's NOT EXISTS incident guard.
    expect(pageWhere).toContain("exists");
    expect(pageWhere).toContain("not exists");
    expect(pageWhere).toContain("occurred_on");
    // Honest total: the multi-token predicate constrains the count identically.
    expect(renderArg(state.countWhere)).toBe(pageWhere);
  });
});

describe("quick filter ↔ glance spec equivalence (AUB-135/AUB-140)", () => {
  // Do not weaken. Each quick token must select exactly the rows whose
  // displayed glance matches — `celiac`→"celiac-safe", `recent`→freshness
  // "fresh" — and a faceted set must select exactly the rows matching every
  // selected token (conjunction). The same evidence shapes the trust-tier
  // suite uses drive the assertion: the quick predicate's boolean ⟺ the pure
  // glance reading.
  const MONTH = 30 * 24 * 60 * 60 * 1000;
  const cutoff = stalenessCutoff(NOW, DEFAULT_STALENESS_MONTHS);
  const ago = (ms: number) => new Date(NOW.getTime() - ms);

  const evidence: Array<{
    label: string;
    confirms: number;
    disputes: number;
    lastConfirmedAt: Date | null;
  }> = [
    { label: "fresh confirm-majority", confirms: 8, disputes: 1, lastConfirmedAt: ago(3 * MONTH) },
    {
      label: "confirm-majority stale",
      confirms: 30,
      disputes: 0,
      lastConfirmedAt: ago(24 * MONTH),
    },
    { label: "tie", confirms: 2, disputes: 2, lastConfirmedAt: ago(1 * MONTH) },
    { label: "dispute-majority", confirms: 1, disputes: 10, lastConfirmedAt: ago(1 * MONTH) },
    { label: "dispute-only", confirms: 0, disputes: 4, lastConfirmedAt: null },
    { label: "no evidence", confirms: 0, disputes: 0, lastConfirmedAt: null },
  ];

  it("celiac ⟺ safetyState 'celiac-safe', and NEVER matches a contested claim", () => {
    for (const c of evidence) {
      const headline = deriveHeadlineSafetyState(
        { confirmCount: c.confirms, disputeCount: c.disputes, lastConfirmedAt: c.lastConfirmedAt },
        NOW,
        DEFAULT_STALENESS_MONTHS
      );
      const matches = quickCeliacMatches(c.confirms, c.disputes, c.lastConfirmedAt, cutoff);
      expect(matches, `${c.label}: celiac vs headline`).toBe(headline === "celiac-safe");
      // The safety half stated directly: a listing whose disputes tie or lead
      // is never in the celiac-filtered result set, whatever its confirm count.
      if (c.disputes >= c.confirms) {
        expect(matches, `${c.label}: contested must not match celiac`).toBe(false);
      }
    }
  });

  it("recent ⟺ freshness.kind 'fresh' (within-window confirmation, no recent incident)", () => {
    const recencyCases: Array<{ lastConfirmedAt: Date | null; recentIncidentAt: Date | null }> = [
      { lastConfirmedAt: ago(1 * MONTH), recentIncidentAt: null }, // fresh, no incident → fresh
      { lastConfirmedAt: ago(1 * MONTH), recentIncidentAt: ago(2 * 24 * 60 * 60 * 1000) }, // incident outranks
      { lastConfirmedAt: ago(24 * MONTH), recentIncidentAt: null }, // stale confirmation → not fresh
      { lastConfirmedAt: null, recentIncidentAt: null }, // never confirmed → no cue
    ];
    for (const c of recencyCases) {
      const freshness = formatFreshness(
        c.lastConfirmedAt,
        c.recentIncidentAt,
        NOW,
        DEFAULT_STALENESS_MONTHS
      );
      expect(
        quickRecentMatches(c.lastConfirmedAt, cutoff, c.recentIncidentAt),
        `lastConfirmed=${String(c.lastConfirmedAt)} incident=${String(c.recentIncidentAt)}`
      ).toBe(freshness?.kind === "fresh");
    }
  });

  it("a SET matches iff EVERY selected token matches — {celiac, recent} conjunction", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const cases: Array<{
      label: string;
      confirms: number;
      disputes: number;
      lastConfirmedAt: Date | null;
      recentIncidentAt: Date | null;
    }> = [
      // celiac-safe AND fresh, no incident → the set matches.
      {
        label: "celiac-safe + fresh, no incident",
        confirms: 8,
        disputes: 1,
        lastConfirmedAt: ago(1 * MONTH),
        recentIncidentAt: null,
      },
      // celiac-safe by the safety glance, but a recent incident makes
      // freshness "incident" not "fresh", so `recent` fails and the set
      // excludes it even though `celiac` alone would match — the whole point
      // of AND-composition.
      {
        label: "celiac-safe but recent incident",
        confirms: 8,
        disputes: 1,
        lastConfirmedAt: ago(1 * MONTH),
        recentIncidentAt: ago(2 * DAY),
      },
      // fresh confirmation but dispute-majority → `recent` matches, `celiac` fails.
      {
        label: "fresh but dispute-majority",
        confirms: 1,
        disputes: 10,
        lastConfirmedAt: ago(1 * MONTH),
        recentIncidentAt: null,
      },
      // stale confirm-majority → neither token matches.
      {
        label: "stale confirm-majority",
        confirms: 30,
        disputes: 0,
        lastConfirmedAt: ago(24 * MONTH),
        recentIncidentAt: null,
      },
    ];
    for (const c of cases) {
      // The server AND-composes each token's predicate, so the set matches a
      // row iff every token's per-row predicate matches.
      const setMatches =
        quickCeliacMatches(c.confirms, c.disputes, c.lastConfirmedAt, cutoff) &&
        quickRecentMatches(c.lastConfirmedAt, cutoff, c.recentIncidentAt);
      // Cross-checked against the displayed glance directly: a row belongs in
      // the {celiac, recent} result iff its safety glance is "celiac-safe"
      // and its freshness cue is "fresh" — never a row whose card would read
      // differently.
      const headline = deriveHeadlineSafetyState(
        { confirmCount: c.confirms, disputeCount: c.disputes, lastConfirmedAt: c.lastConfirmedAt },
        NOW,
        DEFAULT_STALENESS_MONTHS
      );
      const freshness = formatFreshness(
        c.lastConfirmedAt,
        c.recentIncidentAt,
        NOW,
        DEFAULT_STALENESS_MONTHS
      );
      expect(setMatches, c.label).toBe(headline === "celiac-safe" && freshness?.kind === "fresh");
    }
  });
});
