import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the typed listing-links DB layer (AUB-202) — the login-gated,
 * rate-limited, visibility-checked writes (upsert-by-kind save + idempotent
 * remove) and the public, parent-visibility-filtered read.
 *
 * We model the exact drizzle chains the module uses so we can assert behaviour
 * without a live database, per `docs/agents/testing.md` (the incidents-module
 * test pattern). The pure taxonomy + Zod schemas live in
 * `app/listings/links.ts` and are tested there (no mocks needed).
 */

// --- Mocks -----------------------------------------------------------------
// DB chains modeled:
//   read list:      getDb().select().from().innerJoin().where().orderBy() -> rows
//   listing lookup: getDb().query.listings.findFirst({ where })           -> row | undefined
//   save (upsert):  getDb().insert().values().onConflictDoUpdate().returning() -> [row]
//   remove:         getDb().delete().where()                              -> resolves
const h = vi.hoisted(() => {
  const state = {
    listRows: [] as Array<Record<string, unknown>>,
    listingVisible: true,
    lastInsertValues: undefined as unknown,
    lastConflictArgs: undefined as unknown,
    lastOrderByArgs: [] as unknown[],
    lastListWhere: undefined as unknown,
    lastDeleteWhere: undefined as unknown,
    upsertedRows: [{ id: "link-1" }] as Array<Record<string, unknown>>,
    signedIn: true,
  };

  const orderByMock = vi.fn((...args: unknown[]) => {
    state.lastOrderByArgs = args;
    return Promise.resolve(state.listRows);
  });
  const selectWhereMock = vi.fn((predicate?: unknown) => {
    state.lastListWhere = predicate;
    return { orderBy: orderByMock };
  });
  // The list read INNER JOINs `listings` (parent-listing visibility gate).
  const innerJoinMock = vi.fn(() => ({ where: selectWhereMock }));
  const fromMock = vi.fn(() => ({ innerJoin: innerJoinMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  // The visible-listing existence check before every write.
  const findFirstMock = vi.fn((_args?: { where?: unknown }) =>
    Promise.resolve(state.listingVisible ? { id: "listing-1" } : undefined)
  );

  const returningMock = vi.fn(() => Promise.resolve(state.upsertedRows));
  const onConflictDoUpdateMock = vi.fn((args: unknown) => {
    state.lastConflictArgs = args;
    return { returning: returningMock };
  });
  const valuesMock = vi.fn((vals: unknown) => {
    state.lastInsertValues = vals;
    return { onConflictDoUpdate: onConflictDoUpdateMock };
  });
  const insertMock = vi.fn(() => ({ values: valuesMock }));

  const deleteWhereMock = vi.fn((predicate?: unknown) => {
    state.lastDeleteWhere = predicate;
    return Promise.resolve(undefined);
  });
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

  const requireCurrentUserMock = vi.fn(() => {
    if (!state.signedIn) {
      return Promise.reject(new Error("Authentication required."));
    }
    return Promise.resolve({ id: "user-1" });
  });

  const enforceWriteLimitMock = vi.fn((_userId?: string) => Promise.resolve());

  return {
    state,
    selectMock,
    orderByMock,
    innerJoinMock,
    findFirstMock,
    insertMock,
    valuesMock,
    onConflictDoUpdateMock,
    deleteMock,
    requireCurrentUserMock,
    enforceWriteLimitMock,
  };
});

vi.mock("~/db/client", () => ({
  getDb: () => ({
    select: h.selectMock,
    insert: h.insertMock,
    delete: h.deleteMock,
    query: { listings: { findFirst: h.findFirstMock } },
  }),
}));

vi.mock("~/server/auth/guards", () => ({
  requireCurrentUser: h.requireCurrentUserMock,
}));

vi.mock("~/server/rate-limit", () => ({
  enforceWriteLimit: h.enforceWriteLimitMock,
}));

import { listListingLinks, removeListingLink, saveListingLink } from "./index";

const {
  state,
  orderByMock,
  innerJoinMock,
  findFirstMock,
  insertMock,
  onConflictDoUpdateMock,
  deleteMock,
  requireCurrentUserMock,
  enforceWriteLimitMock,
} = h;

// Render a captured WHERE predicate to inspect its columns + bound params.
const dialect = new PgDialect();
function renderWhere(predicate: unknown): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(predicate as SQL);
  return { sql: query.sql.toLowerCase(), params: query.params };
}

beforeEach(() => {
  state.listRows = [];
  state.listingVisible = true;
  state.lastInsertValues = undefined;
  state.lastConflictArgs = undefined;
  state.lastOrderByArgs = [];
  state.lastListWhere = undefined;
  state.lastDeleteWhere = undefined;
  state.upsertedRows = [{ id: "link-1" }];
  state.signedIn = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

const saveInput = {
  listingId: "listing-1",
  kind: "menu",
  url: "https://example.com/menu",
} as const;

describe("saveListingLink — login-gated, rate-limited, visibility-checked upsert", () => {
  it("upserts on the (listing, kind) unique target and updates only url + updatedAt", async () => {
    await saveListingLink(saveInput);

    expect(insertMock).toHaveBeenCalledTimes(1);
    // Insert path: full values including provenance.
    expect(state.lastInsertValues).toEqual({
      listingId: "listing-1",
      kind: "menu",
      url: "https://example.com/menu",
      createdBy: "user-1",
    });
    // Conflict path: url + updatedAt only — createdBy is NEVER rewritten, so
    // the original contributor's provenance survives someone else's edit.
    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(1);
    const conflict = state.lastConflictArgs as {
      target: unknown[];
      set: Record<string, unknown>;
    };
    expect(conflict.target).toHaveLength(2);
    expect(Object.keys(conflict.set).sort()).toEqual(["updatedAt", "url"]);
    expect(conflict.set.url).toBe("https://example.com/menu");
    expect(conflict.set.updatedAt).toBeInstanceOf(Date);
  });

  it("returns the upserted row", async () => {
    state.upsertedRows = [{ id: "link-9", kind: "menu" }];
    await expect(saveListingLink(saveInput)).resolves.toEqual({ id: "link-9", kind: "menu" });
  });

  it("requires a signed-in user (401 gate); no write happens", async () => {
    state.signedIn = false;
    await expect(saveListingLink(saveInput)).rejects.toThrow("Authentication required.");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rate-limits the authenticated user before writing (#18)", async () => {
    await saveListingLink(saveInput);
    expect(enforceWriteLimitMock).toHaveBeenCalledTimes(1);
    expect(enforceWriteLimitMock).toHaveBeenCalledWith("user-1");
  });

  it("does not write when the rate limit is exceeded (429)", async () => {
    const tooFast = new HTTPException(429, { message: "too fast" });
    enforceWriteLimitMock.mockRejectedValueOnce(tooFast);

    await expect(saveListingLink(saveInput)).rejects.toBe(tooFast);
    expect(insertMock).not.toHaveBeenCalled();
    // The limiter also short-circuits the listing lookup.
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("404s on a missing or hidden/removed listing; no write happens (#41)", async () => {
    state.listingVisible = false;

    await expect(saveListingLink(saveInput)).rejects.toMatchObject({ status: 404 });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("scopes the listing check to visible rows (no moderation-state oracle)", async () => {
    await saveListingLink(saveInput);

    const where = findFirstMock.mock.calls[0]?.[0]?.where;
    const { sql, params } = renderWhere(where);
    expect(sql).toContain('"id"');
    expect(sql).toContain("moderation_status");
    expect(params).toContain("listing-1");
    expect(params).toContain("visible");
  });

  it("imposes NO ownership check — wiki-style, any signed-in user (AUB-202)", async () => {
    // The write path touches exactly: auth, rate limit, the visible-listing
    // lookup, and the upsert. Nothing compares the current user to any stored
    // creator — deliberately (product decision, do not add one).
    await saveListingLink(saveInput);
    expect(requireCurrentUserMock).toHaveBeenCalledTimes(1);
    const { sql } = renderWhere(findFirstMock.mock.calls[0]?.[0]?.where);
    expect(sql).not.toContain("created_by");
  });
});

describe("removeListingLink — login-gated, rate-limited, visibility-checked delete", () => {
  const removeInput = { listingId: "listing-1", kind: "menu" } as const;

  it("deletes the (listing, kind) row", async () => {
    await removeListingLink(removeInput);

    expect(deleteMock).toHaveBeenCalledTimes(1);
    const { sql, params } = renderWhere(state.lastDeleteWhere);
    expect(sql).toContain("listing_id");
    expect(sql).toContain('"kind"');
    expect(sql).toContain(" and ");
    expect(params).toContain("listing-1");
    expect(params).toContain("menu");
  });

  it("is a no-op success when the kind has no link (idempotent delete)", async () => {
    // The mocked delete matches zero rows either way; the call must resolve.
    await expect(removeListingLink(removeInput)).resolves.toBeUndefined();
  });

  it("requires a signed-in user (401 gate); no delete happens", async () => {
    state.signedIn = false;
    await expect(removeListingLink(removeInput)).rejects.toThrow("Authentication required.");
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("does not delete when the rate limit is exceeded (429)", async () => {
    const tooFast = new HTTPException(429, { message: "too fast" });
    enforceWriteLimitMock.mockRejectedValueOnce(tooFast);

    await expect(removeListingLink(removeInput)).rejects.toBe(tooFast);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("404s on a missing or hidden/removed listing; no delete happens (#41)", async () => {
    state.listingVisible = false;

    await expect(removeListingLink(removeInput)).rejects.toMatchObject({ status: 404 });
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("listListingLinks — public read in LINK_KINDS order", () => {
  it("orders by the kind enum column (declaration order = LINK_KINDS order) and stays anonymous", async () => {
    state.listRows = [
      { id: "a", kind: "menu" },
      { id: "b", kind: "website" },
    ];

    const rows = await listListingLinks({ listingId: "listing-1" });

    // Reads must not require auth or the rate limiter.
    expect(requireCurrentUserMock).not.toHaveBeenCalled();
    expect(enforceWriteLimitMock).not.toHaveBeenCalled();
    // One ASC order key on the enum `kind` column: Postgres sorts an enum by
    // its declaration order, which derives from LINK_KINDS — deterministic.
    expect(orderByMock).toHaveBeenCalledTimes(1);
    expect(state.lastOrderByArgs).toHaveLength(1);
    const orderSql = dialect.sqlToQuery(state.lastOrderByArgs[0] as SQL).sql.toLowerCase();
    expect(orderSql).toContain('"kind"');
    expect(orderSql).toContain("asc");
    // Passes the DB ordering straight through.
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("requires the PARENT listing visible — a hidden/removed listing leaks no links (#41)", async () => {
    // Links carry no moderation state of their own and `moderationStatus` has
    // no parent→child propagation, so this addressable per-listing RPC INNER
    // JOINs `listings` and requires the parent `visible`.
    await listListingLinks({ listingId: "listing-1" });

    expect(innerJoinMock).toHaveBeenCalledTimes(1);
    const { sql, params } = renderWhere(state.lastListWhere);
    expect(sql).toContain("listing_id");
    expect(sql).toContain('"listings"."moderation_status"');
    expect(sql).toContain(" and ");
    expect(params).toContain("listing-1");
    expect(params).toContain("visible");
  });
});
