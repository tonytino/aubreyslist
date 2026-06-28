import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the incident reports DB layer (#30) — the login-gated, rate-limited
 * write and the most-recent-first read.
 *
 * The module's only server-only dependencies are the DB client and the auth
 * guard. We model the exact drizzle chains it uses so we can assert behaviour
 * — the login gate, most-recent-first ordering, and the rate-limit
 * short-circuit — without a live database, per `docs/agents/testing.md`. The
 * pure recency helpers + input schema live in `app/trust/incident-recency.ts`
 * and are tested there (no mocks needed).
 */

// --- Mocks -----------------------------------------------------------------
// DB chains modeled:
//   read list: getDb().select().from().where().orderBy()          -> rows
//   insert:    getDb().insert().values().returning()              -> [row]
//   edit:      getDb().update().set().where().returning()         -> updatedRows
//   retract:   getDb().delete().where().returning({ id })         -> deletedRows
const h = vi.hoisted(() => {
  const state = {
    listRows: [] as Array<Record<string, unknown>>,
    lastInsertValues: undefined as unknown,
    lastOrderByArgs: [] as unknown[],
    lastUpdateSet: undefined as unknown,
    // The WHERE predicates handed to the edit UPDATE / retract DELETE — captured
    // so we can assert ownership filters by BOTH `id` AND `userId` (#114).
    lastUpdateWhere: undefined as unknown,
    lastDeleteWhere: undefined as unknown,
    // Rows the UPDATE ... RETURNING resolves to: non-empty ⇒ owner match.
    updatedRows: [{ id: "incident-1" }] as Array<Record<string, unknown>>,
    // Rows the DELETE ... RETURNING resolves to: non-empty ⇒ owner match.
    deletedRows: [{ id: "incident-1" }] as Array<Record<string, unknown>>,
    signedIn: true,
  };

  const orderByMock = vi.fn((...args: unknown[]) => {
    state.lastOrderByArgs = args;
    return Promise.resolve(state.listRows);
  });
  const selectWhereMock = vi.fn(() => ({ orderBy: orderByMock }));
  const fromMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  const returningMock = vi.fn(() =>
    Promise.resolve([{ id: "incident-1", ...(state.lastInsertValues as object) }])
  );
  const valuesMock = vi.fn((vals: unknown) => {
    state.lastInsertValues = vals;
    return { returning: returningMock };
  });
  const insertMock = vi.fn(() => ({ values: valuesMock }));

  // update().set().where().returning() — ownership is the (id, userId) predicate.
  const updateReturningMock = vi.fn(() => Promise.resolve(state.updatedRows));
  const updateWhereMock = vi.fn((predicate?: unknown) => {
    state.lastUpdateWhere = predicate;
    return { returning: updateReturningMock };
  });
  const setMock = vi.fn((vals: unknown) => {
    state.lastUpdateSet = vals;
    return { where: updateWhereMock };
  });
  const updateMock = vi.fn(() => ({ set: setMock }));

  // delete().where().returning({ id }) — ownership is the (id, userId) predicate.
  const deleteReturningMock = vi.fn(() => Promise.resolve(state.deletedRows));
  const deleteWhereMock = vi.fn((predicate?: unknown) => {
    state.lastDeleteWhere = predicate;
    return { returning: deleteReturningMock };
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
    insertMock,
    valuesMock,
    updateMock,
    setMock,
    deleteMock,
    requireCurrentUserMock,
    enforceWriteLimitMock,
  };
});

vi.mock("~/db/client", () => ({
  getDb: () => ({
    select: h.selectMock,
    insert: h.insertMock,
    update: h.updateMock,
    delete: h.deleteMock,
  }),
}));

vi.mock("~/server/auth/guards", () => ({
  requireCurrentUser: h.requireCurrentUserMock,
}));

vi.mock("~/server/rate-limit", () => ({
  enforceWriteLimit: h.enforceWriteLimitMock,
}));

import { editIncident, listIncidents, reportIncident, retractIncident } from "./index";

const {
  state,
  insertMock,
  orderByMock,
  updateMock,
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
  state.lastInsertValues = undefined;
  state.lastOrderByArgs = [];
  state.lastUpdateSet = undefined;
  state.lastUpdateWhere = undefined;
  state.lastDeleteWhere = undefined;
  state.updatedRows = [{ id: "incident-1" }];
  state.deletedRows = [{ id: "incident-1" }];
  state.signedIn = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("reportIncident — login-gated, rate-limited write", () => {
  it("inserts the incident for the authenticated user", async () => {
    await reportIncident({ listingId: "listing-1", occurredOn: "2026-06-01", severity: "severe" });

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(state.lastInsertValues).toEqual({
      listingId: "listing-1",
      userId: "user-1",
      occurredOn: "2026-06-01",
      severity: "severe",
      note: null,
    });
  });

  it("requires a signed-in user (401 gate); no write happens", async () => {
    state.signedIn = false;
    await expect(
      reportIncident({ listingId: "listing-1", occurredOn: "2026-06-01" })
    ).rejects.toThrow("Authentication required.");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rate-limits the authenticated user before writing (#18)", async () => {
    await reportIncident({ listingId: "listing-1", occurredOn: "2026-06-01" });

    expect(enforceWriteLimitMock).toHaveBeenCalledTimes(1);
    expect(enforceWriteLimitMock).toHaveBeenCalledWith("user-1");
  });

  it("does not write when the rate limit is exceeded (429)", async () => {
    const tooFast = new HTTPException(429, { message: "too fast" });
    enforceWriteLimitMock.mockRejectedValueOnce(tooFast);

    await expect(reportIncident({ listingId: "listing-1", occurredOn: "2026-06-01" })).rejects.toBe(
      tooFast
    );
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("editIncident — owner-only, server-enforced", () => {
  it("updates the incident when the current user owns it", async () => {
    const row = await editIncident({
      id: "incident-1",
      occurredOn: "2026-06-15",
      severity: "moderate",
      note: "updated",
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    // The new field values (and a bumped updatedAt) are written.
    const set = state.lastUpdateSet as Record<string, unknown>;
    expect(set.occurredOn).toBe("2026-06-15");
    expect(set.severity).toBe("moderate");
    expect(set.note).toBe("updated");
    expect(set.updatedAt).toBeInstanceOf(Date);
    expect(row).toEqual({ id: "incident-1" });
  });

  it("rejects a non-owner: zero rows updated ⇒ 403, surfaced as a throw", async () => {
    // The (id, userId) predicate matches nothing when the row is not the user's.
    state.updatedRows = [];
    await expect(editIncident({ id: "incident-1", occurredOn: "2026-06-15" })).rejects.toThrow(
      /your own incident/i
    );
  });

  it("filters the UPDATE by BOTH id AND userId (ownership is in the WHERE, not just the 403)", async () => {
    // The 403 above only proves "zero rows ⇒ reject". This pins WHY zero rows:
    // the WHERE must constrain on BOTH the incident `id` AND the current user's
    // `userId`. An id-only predicate would let a non-owner's edit MATCH the row
    // (and silently succeed) — so we assert both columns and both bound values.
    await editIncident({ id: "incident-1", occurredOn: "2026-06-15" });

    expect(state.lastUpdateWhere).toBeDefined();
    const { sql, params } = renderWhere(state.lastUpdateWhere);
    // Both ownership columns are referenced, AND-combined.
    expect(sql).toContain('"id"');
    expect(sql).toContain('"user_id"');
    expect(sql).toContain(" and ");
    // Both the target id and the authenticated user's id are bound as params, so
    // a non-owner row can never satisfy the predicate.
    expect(params).toContain("incident-1");
    expect(params).toContain("user-1");
  });

  it("rejects an anonymous caller (401 gate); no update happens", async () => {
    state.signedIn = false;
    await expect(editIncident({ id: "incident-1", occurredOn: "2026-06-15" })).rejects.toThrow(
      "Authentication required."
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rate-limits the authenticated user before writing (#18)", async () => {
    await editIncident({ id: "incident-1", occurredOn: "2026-06-15" });

    expect(enforceWriteLimitMock).toHaveBeenCalledTimes(1);
    expect(enforceWriteLimitMock).toHaveBeenCalledWith("user-1");
  });

  it("does not update when the rate limit is exceeded (429)", async () => {
    const tooFast = new HTTPException(429, { message: "too fast" });
    enforceWriteLimitMock.mockRejectedValueOnce(tooFast);

    await expect(editIncident({ id: "incident-1", occurredOn: "2026-06-15" })).rejects.toBe(
      tooFast
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("clears optional severity/note when omitted (edit can blank them)", async () => {
    await editIncident({ id: "incident-1", occurredOn: "2026-06-15" });

    const set = state.lastUpdateSet as Record<string, unknown>;
    expect(set.severity).toBeNull();
    expect(set.note).toBeNull();
  });
});

describe("retractIncident — owner-only, server-enforced", () => {
  it("deletes the incident when the current user owns it", async () => {
    await retractIncident({ id: "incident-1" });
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-owner: zero rows deleted ⇒ 403, surfaced as a throw", async () => {
    state.deletedRows = [];
    await expect(retractIncident({ id: "incident-1" })).rejects.toThrow(/your own incident/i);
  });

  it("filters the DELETE by BOTH id AND userId (ownership is in the WHERE, not just the 403)", async () => {
    // As with edit: an id-only DELETE predicate would let a non-owner retract
    // someone else's report. Pin both ownership columns + both bound values.
    await retractIncident({ id: "incident-1" });

    expect(state.lastDeleteWhere).toBeDefined();
    const { sql, params } = renderWhere(state.lastDeleteWhere);
    expect(sql).toContain('"id"');
    expect(sql).toContain('"user_id"');
    expect(sql).toContain(" and ");
    expect(params).toContain("incident-1");
    expect(params).toContain("user-1");
  });

  it("rejects an anonymous caller (401 gate); no delete happens", async () => {
    state.signedIn = false;
    await expect(retractIncident({ id: "incident-1" })).rejects.toThrow("Authentication required.");
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("rate-limits the authenticated user before deleting (#18)", async () => {
    await retractIncident({ id: "incident-1" });

    expect(enforceWriteLimitMock).toHaveBeenCalledTimes(1);
    expect(enforceWriteLimitMock).toHaveBeenCalledWith("user-1");
  });

  it("does not delete when the rate limit is exceeded (429)", async () => {
    const tooFast = new HTTPException(429, { message: "too fast" });
    enforceWriteLimitMock.mockRejectedValueOnce(tooFast);

    await expect(retractIncident({ id: "incident-1" })).rejects.toBe(tooFast);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("listIncidents — most-recent first", () => {
  it("orders by occurredOn desc (then createdAt desc) and stays anonymous", async () => {
    state.listRows = [
      { id: "b", occurredOn: "2026-06-10" },
      { id: "a", occurredOn: "2026-05-01" },
    ];

    const rows = await listIncidents({ listingId: "listing-1" });

    // Reads must not require auth.
    expect(requireCurrentUserMock).not.toHaveBeenCalled();
    // Two desc order keys were passed to orderBy.
    expect(orderByMock).toHaveBeenCalledTimes(1);
    expect(state.lastOrderByArgs).toHaveLength(2);
    // Passes the DB ordering straight through.
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});
