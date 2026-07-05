import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the favorites write + read layer (AUB-120 / F2).
 *
 * The module's only server-only deps are the DB client, the auth guard, the
 * current-user accessor, and the rate limiter. We model the exact drizzle chains
 * it uses so we can assert behaviour — the idempotent add, the delete no-op, the
 * visibility gate, and the count aggregate — without a live database, per
 * `docs/agents/testing.md` (minimal mocking). Because everything is mocked these
 * tests run everywhere (locally and in CI) with no DB gating — nothing is skipped.
 *
 * DB chains modeled:
 *   listing lookup:  getDb().select().from().where().limit()          -> [{ moderationStatus }]
 *   insert favorite: getDb().insert().values().onConflictDoNothing({ target })
 *   delete favorite: getDb().delete().where()
 *   viewer ids:      getDb().select().from().innerJoin().where()       -> [{ listingId }]
 *   counts:          getDb().select().from().where().groupBy()         -> grouped rows
 */
const h = vi.hoisted(() => {
  const state = {
    // The `.limit()` chain backs the addFavorite listing-visibility lookup.
    limitRows: [] as Array<{ moderationStatus: "visible" | "hidden" | "removed" }>,
    // The terminal `.where()` (no limit/groupBy) backs getViewerFavoriteIds.
    viewerRows: [] as Array<{ listingId: string }>,
    // The `.orderBy()` chain backs getViewerFavorites (rows projected as { listing }).
    favoriteListingRows: [] as Array<{ listing: { id: string } }>,
    // The `.groupBy()` chain backs getFavoriteCounts.
    groupByRows: [] as Array<{ listingId: string; n: number }>,
    lastInsertValues: undefined as unknown,
    lastDoNothingArgs: undefined as unknown,
    signedIn: true,
  };

  const limitMock = vi.fn(() => Promise.resolve(state.limitRows));
  const groupByMock = vi.fn(() => Promise.resolve(state.groupByRows));
  const orderByMock = vi.fn(() => Promise.resolve(state.favoriteListingRows));
  // `.where()` is shared by all reads/deletes. It resolves to the viewer rows
  // (so `await select().from().innerJoin().where()` works for getViewerFavoriteIds),
  // with `.limit()` (listing lookup), `.groupBy()` (counts), and `.orderBy()`
  // (getViewerFavorites) attached for the reads that chain further.
  const selectWhereMock = vi.fn(() => {
    const result = Promise.resolve(state.viewerRows) as Promise<Array<{ listingId: string }>> & {
      limit: typeof limitMock;
      groupBy: typeof groupByMock;
      orderBy: typeof orderByMock;
    };
    result.limit = limitMock;
    result.groupBy = groupByMock;
    result.orderBy = orderByMock;
    return result;
  });
  const innerJoinMock = vi.fn(() => ({ where: selectWhereMock }));
  const fromMock = vi.fn(() => ({ where: selectWhereMock, innerJoin: innerJoinMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  const onConflictDoNothingMock = vi.fn((args: unknown) => {
    state.lastDoNothingArgs = args;
    return Promise.resolve();
  });
  const valuesMock = vi.fn((vals: unknown) => {
    state.lastInsertValues = vals;
    return { onConflictDoNothing: onConflictDoNothingMock };
  });
  const insertMock = vi.fn(() => ({ values: valuesMock }));

  const deleteWhereMock = vi.fn(() => Promise.resolve());
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

  // `requireCurrentUser` throws 401 for anonymous callers; here it resolves to a
  // stub user, except when a test flips `state.signedIn` to assert the gate.
  const requireCurrentUserMock = vi.fn(() => {
    if (!state.signedIn) {
      return Promise.reject(new Error("Authentication required."));
    }
    return Promise.resolve({ id: "user-1" });
  });
  // `getCurrentUser` backs the viewer read: `null` for anonymous, else the row.
  const getCurrentUserMock = vi.fn(() => Promise.resolve(state.signedIn ? { id: "user-1" } : null));

  // `enforceWriteLimit` is the per-user write rate limit (#18). We spy on it to
  // assert each write entry point meters the authenticated user.
  const enforceWriteLimitMock = vi.fn((_userId?: string) => Promise.resolve());

  // `buildBrowseCards` is the SHARED, server-only card builder getViewerFavorites
  // reuses. We mock it to echo the listings it receives as trust cores (a neutral
  // glance), so we can assert getViewerFavorites orders + attaches counts without
  // pulling the real (db-backed) glance derivation into this unit test.
  const buildBrowseCardsMock = vi.fn((listings: Array<{ id: string }>) =>
    Promise.resolve(listings.map((listing) => ({ listing, glance: {} })))
  );

  // `Sentry.captureException` — spied so we can assert a degraded read still
  // REPORTS its error (observability is preserved when we swallow it).
  const captureExceptionMock = vi.fn();

  return {
    state,
    limitMock,
    groupByMock,
    orderByMock,
    innerJoinMock,
    selectMock,
    insertMock,
    valuesMock,
    onConflictDoNothingMock,
    deleteMock,
    deleteWhereMock,
    requireCurrentUserMock,
    getCurrentUserMock,
    enforceWriteLimitMock,
    buildBrowseCardsMock,
    captureExceptionMock,
  };
});

vi.mock("~/db/client", () => ({
  getDb: () => ({
    select: h.selectMock,
    insert: h.insertMock,
    delete: h.deleteMock,
  }),
}));

vi.mock("~/server/auth/guards", () => ({
  requireCurrentUser: h.requireCurrentUserMock,
}));

vi.mock("~/server/auth/current-user", () => ({
  getCurrentUser: h.getCurrentUserMock,
}));

vi.mock("~/server/rate-limit", () => ({
  enforceWriteLimit: h.enforceWriteLimitMock,
}));

vi.mock("~/server/listings/browse", () => ({
  buildBrowseCards: h.buildBrowseCardsMock,
}));

vi.mock("@sentry/tanstackstart-react", () => ({
  captureException: h.captureExceptionMock,
}));

import {
  addFavorite,
  getFavoriteCounts,
  getViewerFavoriteIds,
  getViewerFavorites,
  removeFavorite,
} from "./index";

const {
  state,
  selectMock,
  insertMock,
  onConflictDoNothingMock,
  deleteMock,
  deleteWhereMock,
  enforceWriteLimitMock,
} = h;

beforeEach(() => {
  // Default: a found, visible listing so the addFavorite happy path works.
  state.limitRows = [{ moderationStatus: "visible" }];
  state.viewerRows = [];
  state.favoriteListingRows = [];
  state.groupByRows = [];
  state.lastInsertValues = undefined;
  state.lastDoNothingArgs = undefined;
  state.signedIn = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("read degradation — a favorites read failure never 500s the page", () => {
  // The favorites reads run on hot paths (getFavoriteCounts on EVERY browse
  // render + /favorites; getViewerFavoriteIds on the __root prefetch for every
  // signed-in page; getViewerFavorites on /favorites). A read failure — e.g. the
  // `favorites` table briefly unavailable on a fresh/preview DB, or the deploy
  // window before a schema migration applies — must degrade, not crash the page.
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("getFavoriteCounts degrades to an empty map (not a throw) when the aggregate query fails", async () => {
    selectMock.mockImplementationOnce(() => {
      throw new Error('relation "favorites" does not exist');
    });
    const result = await getFavoriteCounts(["listing-1", "listing-2"]);
    expect(result.size).toBe(0);
    // Still reported — degradation is not silent.
    expect(h.captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("getViewerFavoriteIds degrades to [] when the read fails (never 500s the root prefetch)", async () => {
    selectMock.mockImplementationOnce(() => {
      throw new Error('relation "favorites" does not exist');
    });
    const result = await getViewerFavoriteIds();
    expect(result).toEqual([]);
    expect(h.captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("getViewerFavorites degrades to [] when the read fails (/favorites shows its empty state)", async () => {
    selectMock.mockImplementationOnce(() => {
      throw new Error('relation "favorites" does not exist');
    });
    const result = await getViewerFavorites(new Date(0), 6);
    expect(result).toEqual([]);
    expect(h.captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});

describe("addFavorite — idempotent, visibility-gated write", () => {
  it("inserts the favorite for a visible listing (onConflictDoNothing on the unique pair)", async () => {
    await addFavorite({ listingId: "listing-1" });

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(state.lastInsertValues).toEqual({ userId: "user-1", listingId: "listing-1" });
    // The insert is idempotent/race-safe via the (user, listing) unique constraint.
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1);
    const args = state.lastDoNothingArgs as { target: unknown[] };
    expect(args.target).toHaveLength(2);
  });

  it("is idempotent: a repeated favorite routes through onConflictDoNothing without error", async () => {
    await addFavorite({ listingId: "listing-1" });
    await addFavorite({ listingId: "listing-1" });

    // Both calls issue the insert; the DB constraint makes the second a no-op —
    // we assert the code always routes through the conflict-safe upsert.
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(2);
  });

  it("requires a signed-in user (401 gate, impl not reached)", async () => {
    state.signedIn = false;
    await expect(addFavorite({ listingId: "listing-1" })).rejects.toThrow(
      "Authentication required."
    );
    // No DB work when the gate rejects — not even the visibility lookup.
    expect(selectMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rate-limits the authenticated user before any DB work (#18)", async () => {
    await addFavorite({ listingId: "listing-1" });

    expect(enforceWriteLimitMock).toHaveBeenCalledTimes(1);
    expect(enforceWriteLimitMock).toHaveBeenCalledWith("user-1");
  });

  it("does not write when the rate limit is exceeded (429, impl not reached)", async () => {
    const tooFast = new HTTPException(429, { message: "too fast" });
    enforceWriteLimitMock.mockRejectedValueOnce(tooFast);

    await expect(addFavorite({ listingId: "listing-1" })).rejects.toBe(tooFast);
    // Short-circuits before any DB work — no visibility lookup, no insert.
    expect(selectMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects a HIDDEN listing with 404 and never inserts", async () => {
    state.limitRows = [{ moderationStatus: "hidden" }];

    await expect(addFavorite({ listingId: "listing-hidden" })).rejects.toMatchObject({
      status: 404,
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects a REMOVED listing with 404 and never inserts", async () => {
    state.limitRows = [{ moderationStatus: "removed" }];

    await expect(addFavorite({ listingId: "listing-removed" })).rejects.toMatchObject({
      status: 404,
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects a MISSING listing with 404 and never inserts", async () => {
    state.limitRows = []; // listing row not found

    await expect(addFavorite({ listingId: "ghost" })).rejects.toMatchObject({ status: 404 });
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("removeFavorite — deletes the user's row, no-op when absent", () => {
  it("deletes the favorite scoped to the current user + listing", async () => {
    await removeFavorite({ listingId: "listing-1" });

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteWhereMock).toHaveBeenCalledTimes(1);
    // A remove never inserts and never reads visibility — it is delete-only.
    expect(insertMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("is a no-op when no favorite exists (delete matches zero rows, no throw)", async () => {
    // The delete simply matches nothing; the module must not throw or branch.
    await expect(removeFavorite({ listingId: "never-favorited" })).resolves.toBeUndefined();
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("requires a signed-in user (401 gate, impl not reached)", async () => {
    state.signedIn = false;
    await expect(removeFavorite({ listingId: "listing-1" })).rejects.toThrow(
      "Authentication required."
    );
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("rate-limits the authenticated user before any DB work (#18)", async () => {
    await removeFavorite({ listingId: "listing-1" });

    expect(enforceWriteLimitMock).toHaveBeenCalledTimes(1);
    expect(enforceWriteLimitMock).toHaveBeenCalledWith("user-1");
  });

  it("does not delete when the rate limit is exceeded (429, impl not reached)", async () => {
    const tooFast = new HTTPException(429, { message: "too fast" });
    enforceWriteLimitMock.mockRejectedValueOnce(tooFast);

    await expect(removeFavorite({ listingId: "listing-1" })).rejects.toBe(tooFast);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("getViewerFavoriteIds — viewer-scoped, visibility-filtered", () => {
  it("returns [] for an anonymous viewer WITHOUT hitting the DB", async () => {
    state.signedIn = false;

    const ids = await getViewerFavoriteIds();

    expect(ids).toEqual([]);
    // No DB hit at all for anonymous — nothing to look up.
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns the viewer's favorited ids, joining listings to gate on visibility", async () => {
    state.viewerRows = [{ listingId: "listing-1" }, { listingId: "listing-2" }];

    const ids = await getViewerFavoriteIds();

    expect(ids).toEqual(["listing-1", "listing-2"]);
    // The visibility gate is an INNER JOIN on listings filtered to `visible`, so a
    // favorite whose listing was hidden/removed is excluded by the query itself.
    expect(h.innerJoinMock).toHaveBeenCalledTimes(1);
  });

  it("returns [] when the viewer has no visible favorites", async () => {
    state.viewerRows = [];

    const ids = await getViewerFavoriteIds();

    expect(ids).toEqual([]);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });
});

describe("getViewerFavorites — viewer cards, newest-saved first", () => {
  it("returns [] for an anonymous viewer WITHOUT hitting the DB or building cards", async () => {
    state.signedIn = false;

    const cards = await getViewerFavorites(new Date(), 6);

    expect(cards).toEqual([]);
    expect(selectMock).not.toHaveBeenCalled();
    expect(h.buildBrowseCardsMock).not.toHaveBeenCalled();
  });

  it("builds cards via buildBrowseCards and attaches the public save-count per listing", async () => {
    state.favoriteListingRows = [
      { listing: { id: "listing-1" } },
      { listing: { id: "listing-2" } },
    ];
    // listing-1 has 5 saves; listing-2 is absent from the aggregate → defaults to 0.
    state.groupByRows = [{ listingId: "listing-1", n: 5 }];

    const now = new Date("2026-07-03T00:00:00Z");
    const cards = await getViewerFavorites(now, 6);

    // Reuses the SHARED builder with the viewer's listings + the SAME now/window.
    expect(h.buildBrowseCardsMock).toHaveBeenCalledWith(
      [{ id: "listing-1" }, { id: "listing-2" }],
      now,
      6
    );
    // Order is preserved from the query's `favorites.createdAt DESC` ordering.
    expect(h.orderByMock).toHaveBeenCalledTimes(1);
    expect(cards.map((c) => c.listing.id)).toEqual(["listing-1", "listing-2"]);
    expect(cards[0]?.favoriteCount).toBe(5);
    expect(cards[1]?.favoriteCount).toBe(0);
  });

  it("returns [] (no cards) when the viewer has no visible favorites", async () => {
    state.favoriteListingRows = [];

    const cards = await getViewerFavorites(new Date(), 6);

    expect(cards).toEqual([]);
    // buildBrowseCards short-circuits an empty set; no counts query is needed.
    expect(h.buildBrowseCardsMock).toHaveBeenCalledWith([], expect.any(Date), 6);
  });
});

describe("getFavoriteCounts — public, user-agnostic aggregate", () => {
  it("returns an empty map for empty input WITHOUT hitting the DB", async () => {
    const counts = await getFavoriteCounts([]);

    expect(counts.size).toBe(0);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("rolls grouped counts into a map keyed by listing id", async () => {
    state.groupByRows = [
      { listingId: "listing-1", n: 5 },
      { listingId: "listing-2", n: 1 },
    ];

    const counts = await getFavoriteCounts(["listing-1", "listing-2", "listing-3"]);

    expect(counts.get("listing-1")).toBe(5);
    expect(counts.get("listing-2")).toBe(1);
    // A listing with no favorites is simply absent (callers default to 0).
    expect(counts.has("listing-3")).toBe(false);
    expect(counts.size).toBe(2);
  });
});
