import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the claim attestations write + aggregate layer (#28).
 *
 * The module's only server-only dependencies are the DB client and the auth
 * guard. We model the exact drizzle chains it uses so we can assert behaviour
 * — including the one-vote-per-user upsert and the retract delete — without a
 * live database, per `docs/agents/testing.md` (minimal mocking).
 */

// --- Mocks -----------------------------------------------------------------
// The module's server-only deps are the DB client and the auth guard. Both
// mocks live in `vi.hoisted` so the (hoisted) `vi.mock` factories can close
// over them without the "cannot access before initialization" trap. The
// hoisted block exposes the mock fns + mutable test state we assert on.
//
// DB chains modeled:
//   read counts:  getDb().select().from().where().groupBy() -> grouped rows
//   read claim:   getDb().select().from().where().limit()   -> [{ lastConfirmedAt }]
//   upsert:       getDb().insert().values().onConflictDoUpdate()
//   bump:         getDb().update().set().where()
//   retract:      getDb().delete().where()
const h = vi.hoisted(() => {
  const state = {
    groupByRows: [] as Array<{ value: string; n: number }>,
    limitRows: [] as Array<{ lastConfirmedAt: Date | null }>,
    lastInsertValues: undefined as unknown,
    lastConflictArgs: undefined as unknown,
    lastUpdateSet: undefined as unknown,
    signedIn: true,
  };

  const groupByMock = vi.fn(() => Promise.resolve(state.groupByRows));
  const limitMock = vi.fn(() => Promise.resolve(state.limitRows));
  // `.where()` is shared by both reads; it returns the union of next-steps so
  // either `.groupBy()` (counts) or `.limit()` (claim row) resolves.
  const selectWhereMock = vi.fn(() => ({ groupBy: groupByMock, limit: limitMock }));
  const fromMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  const onConflictDoUpdateMock = vi.fn((args: unknown) => {
    state.lastConflictArgs = args;
    return Promise.resolve();
  });
  const valuesMock = vi.fn((vals: unknown) => {
    state.lastInsertValues = vals;
    return { onConflictDoUpdate: onConflictDoUpdateMock };
  });
  const insertMock = vi.fn(() => ({ values: valuesMock }));

  const updateWhereMock = vi.fn(() => Promise.resolve());
  const setMock = vi.fn((vals: unknown) => {
    state.lastUpdateSet = vals;
    return { where: updateWhereMock };
  });
  const updateMock = vi.fn(() => ({ set: setMock }));

  const deleteWhereMock = vi.fn(() => Promise.resolve());
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

  // `requireCurrentUser` throws 401 for anonymous callers; here it resolves to
  // a stub user, except when a test flips `state.signedIn` to assert the gate.
  const requireCurrentUserMock = vi.fn(() => {
    if (!state.signedIn) {
      return Promise.reject(new Error("Authentication required."));
    }
    return Promise.resolve({ id: "user-1" });
  });

  return {
    state,
    groupByMock,
    limitMock,
    insertMock,
    valuesMock,
    onConflictDoUpdateMock,
    updateMock,
    deleteMock,
    deleteWhereMock,
    selectMock,
    requireCurrentUserMock,
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

import { castVote, getClaimAggregate, retractVote } from "./index";

// Convenience aliases so the assertions below stay readable.
const {
  state,
  insertMock,
  valuesMock,
  onConflictDoUpdateMock,
  updateMock,
  deleteMock,
  deleteWhereMock,
  requireCurrentUserMock,
} = h;

beforeEach(() => {
  state.groupByRows = [];
  state.limitRows = [];
  state.lastInsertValues = undefined;
  state.lastConflictArgs = undefined;
  state.lastUpdateSet = undefined;
  state.signedIn = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("castVote — one vote per user per claim (upsert)", () => {
  it("upserts against the (claimId, userId) unique constraint", async () => {
    await castVote({ claimId: "claim-1", value: "confirm" });

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(state.lastInsertValues).toEqual({
      claimId: "claim-1",
      userId: "user-1",
      value: "confirm",
    });
    // The conflict target IS the one-vote-per-user constraint columns.
    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(1);
    const args = state.lastConflictArgs as { target: unknown[]; set: Record<string, unknown> };
    expect(args.target).toHaveLength(2);
    expect(args.set.value).toBe("confirm");
    expect(args.set.updatedAt).toBeInstanceOf(Date);
  });

  it("changing a vote UPDATES the existing row rather than inserting a duplicate", async () => {
    // Same user votes twice on the same claim: confirm then dispute. Both go
    // through the single insert+onConflictDoUpdate path — never two inserts of
    // distinct rows. The DB's unique constraint is what makes the second an
    // update; we assert the code always routes through the upsert.
    await castVote({ claimId: "claim-1", value: "confirm" });
    await castVote({ claimId: "claim-1", value: "dispute" });

    expect(valuesMock).toHaveBeenCalledTimes(2);
    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(2);
    // Second call carries the new value in both the insert and the update set.
    expect(state.lastInsertValues).toEqual({
      claimId: "claim-1",
      userId: "user-1",
      value: "dispute",
    });
    const args = state.lastConflictArgs as { set: Record<string, unknown> };
    expect(args.set.value).toBe("dispute");
  });

  it("requires a signed-in user (401 gate)", async () => {
    state.signedIn = false;
    await expect(castVote({ claimId: "claim-1", value: "confirm" })).rejects.toThrow(
      "Authentication required."
    );
    // No write happens when the gate rejects.
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("castVote — lastConfirmedAt maintenance", () => {
  it("bumps lastConfirmedAt to now on a confirm", async () => {
    await castVote({ claimId: "claim-1", value: "confirm" });

    expect(updateMock).toHaveBeenCalledTimes(1);
    const set = state.lastUpdateSet as { lastConfirmedAt: Date; updatedAt: Date };
    expect(set.lastConfirmedAt).toBeInstanceOf(Date);
    // The upsert's updatedAt and the claim bump share the same `now`.
    const insertSet = (state.lastConflictArgs as { set: { updatedAt: Date } }).set;
    expect(set.lastConfirmedAt).toEqual(insertSet.updatedAt);
  });

  it("does NOT touch lastConfirmedAt on a dispute", async () => {
    await castVote({ claimId: "claim-1", value: "dispute" });

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("retractVote — deletes the user's row", () => {
  it("deletes the current user's attestation for the claim", async () => {
    await retractVote({ claimId: "claim-1" });

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteWhereMock).toHaveBeenCalledTimes(1);
    // Never touches lastConfirmedAt or inserts anything.
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("requires a signed-in user (401 gate)", async () => {
    state.signedIn = false;
    await expect(retractVote({ claimId: "claim-1" })).rejects.toThrow("Authentication required.");
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("getClaimAggregate — counts derive from visible evidence", () => {
  it("rolls up confirm/dispute counts and exposes lastConfirmedAt", async () => {
    state.groupByRows = [
      { value: "confirm", n: 8 },
      { value: "dispute", n: 1 },
    ];
    const when = new Date("2026-06-01T00:00:00Z");
    state.limitRows = [{ lastConfirmedAt: when }];

    const agg = await getClaimAggregate({ claimId: "claim-1" });

    expect(agg).toEqual({
      claimId: "claim-1",
      confirmCount: 8,
      disputeCount: 1,
      lastConfirmedAt: when,
    });
  });

  it("returns zero counts and null recency for a claim with no attestations", async () => {
    state.groupByRows = [];
    state.limitRows = [{ lastConfirmedAt: null }];

    const agg = await getClaimAggregate({ claimId: "claim-empty" });

    expect(agg).toEqual({
      claimId: "claim-empty",
      confirmCount: 0,
      disputeCount: 0,
      lastConfirmedAt: null,
    });
  });

  it("treats a missing claim row as null recency (no throw)", async () => {
    state.groupByRows = [{ value: "confirm", n: 2 }];
    state.limitRows = []; // claim row not found

    const agg = await getClaimAggregate({ claimId: "ghost" });

    expect(agg.confirmCount).toBe(2);
    expect(agg.disputeCount).toBe(0);
    expect(agg.lastConfirmedAt).toBeNull();
  });

  it("does not require auth (reads are open)", async () => {
    state.signedIn = false; // would block a write, but reads must stay anonymous
    state.groupByRows = [{ value: "dispute", n: 3 }];
    state.limitRows = [{ lastConfirmedAt: null }];

    const agg = await getClaimAggregate({ claimId: "claim-1" });

    expect(agg.disputeCount).toBe(3);
    expect(requireCurrentUserMock).not.toHaveBeenCalled();
  });
});
