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
//   read list: getDb().select().from().where().orderBy() -> rows
//   insert:    getDb().insert().values().returning()      -> [row]
const h = vi.hoisted(() => {
  const state = {
    listRows: [] as Array<Record<string, unknown>>,
    lastInsertValues: undefined as unknown,
    lastOrderByArgs: [] as unknown[],
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
    requireCurrentUserMock,
    enforceWriteLimitMock,
  };
});

vi.mock("~/db/client", () => ({
  getDb: () => ({
    select: h.selectMock,
    insert: h.insertMock,
  }),
}));

vi.mock("~/server/auth/guards", () => ({
  requireCurrentUser: h.requireCurrentUserMock,
}));

vi.mock("~/server/rate-limit", () => ({
  enforceWriteLimit: h.enforceWriteLimitMock,
}));

import { listIncidents, reportIncident } from "./index";

const { state, insertMock, orderByMock, requireCurrentUserMock, enforceWriteLimitMock } = h;

beforeEach(() => {
  state.listRows = [];
  state.lastInsertValues = undefined;
  state.lastOrderByArgs = [];
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
