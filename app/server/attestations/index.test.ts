import { HTTPException } from "hono/http-exception";
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
//   read claim:    getDb().select().from().where().limit()   -> [{ moderationStatus, lastConfirmedAt }]
//   read counts:   getDb().select().from().where().groupBy() -> grouped rows
//   recompute max: getDb().select().from().where()           -> [{ lastConfirmedAt }]
//   upsert:        getDb().insert().values().onConflictDoUpdate()
//   bump/recompute:getDb().update().set().where()
//   retract:       getDb().delete().where()
const h = vi.hoisted(() => {
  const state = {
    groupByRows: [] as Array<{ value: string; n: number }>,
    // The `.limit()` chain backs two different reads: the lazy-create claim-id
    // read-back (`{ id }`) in the write path (#150), and the visibility + recency
    // lookup in `getClaimAggregate` (`{ moderationStatus, lastConfirmedAt }`, #41).
    limitRows: [] as Array<
      | { id: string }
      | { moderationStatus?: "visible" | "hidden" | "removed"; lastConfirmedAt: Date | null }
    >,
    // The recompute helper's `select().from().where()` resolves directly (no
    // `.groupBy()`/`.limit()`): MAX(updatedAt) over the surviving confirms.
    maxRows: [] as Array<{ lastConfirmedAt: Date | null }>,
    lastInsertValues: undefined as unknown,
    lastConflictArgs: undefined as unknown,
    lastDoNothingArgs: undefined as unknown,
    lastUpdateSet: undefined as unknown,
    // Every insert's `.values(...)` payload, in call order: the lazy claim
    // upsert (#150) lands first, the attestation upsert second.
    insertValuesLog: [] as unknown[],
    signedIn: true,
  };

  const groupByMock = vi.fn(() => Promise.resolve(state.groupByRows));
  const limitMock = vi.fn(() => Promise.resolve(state.limitRows));
  // `.where()` is shared by all three reads. It returns a real Promise that
  // resolves to the recompute's MAX rows (so `await select().from().where()`
  // works for `recomputeLastConfirmedAt`), with `.groupBy()` (counts) and
  // `.limit()` (claim row) attached for the two aggregate reads that chain on.
  const selectWhereMock = vi.fn(() => {
    const result = Promise.resolve(state.maxRows) as Promise<
      Array<{ lastConfirmedAt: Date | null }>
    > & { groupBy: typeof groupByMock; limit: typeof limitMock };
    result.groupBy = groupByMock;
    result.limit = limitMock;
    return result;
  });
  const fromMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  const onConflictDoUpdateMock = vi.fn((args: unknown) => {
    state.lastConflictArgs = args;
    return Promise.resolve();
  });
  // The lazy claim creation (#150) upserts via `onConflictDoNothing` on the
  // (listing, attribute) unique constraint — a distinct conflict resolution from
  // the attestation upsert's `onConflictDoUpdate`.
  const onConflictDoNothingMock = vi.fn((args: unknown) => {
    state.lastDoNothingArgs = args;
    return Promise.resolve();
  });
  const valuesMock = vi.fn((vals: unknown) => {
    state.lastInsertValues = vals;
    state.insertValuesLog.push(vals);
    return {
      onConflictDoUpdate: onConflictDoUpdateMock,
      onConflictDoNothing: onConflictDoNothingMock,
    };
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

  // `enforceWriteLimit` is the per-user write rate limit (#18). We spy on it to
  // assert each write entry point meters the authenticated user; the limiter's
  // own window logic has dedicated coverage in `rate-limit/index.test.ts`.
  const enforceWriteLimitMock = vi.fn((_userId?: string) => Promise.resolve());

  return {
    state,
    groupByMock,
    limitMock,
    insertMock,
    valuesMock,
    onConflictDoUpdateMock,
    onConflictDoNothingMock,
    updateMock,
    deleteMock,
    deleteWhereMock,
    selectMock,
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

import { castVote, getClaimAggregate, retractVote } from "./index";

// Convenience aliases so the assertions below stay readable.
const {
  state,
  insertMock,
  valuesMock,
  onConflictDoUpdateMock,
  onConflictDoNothingMock,
  updateMock,
  deleteMock,
  deleteWhereMock,
  requireCurrentUserMock,
  enforceWriteLimitMock,
} = h;

beforeEach(() => {
  state.groupByRows = [];
  // The lazy-create read-back (#150) resolves the claim id from this `.limit()`
  // chain; default to a found claim so the write tests exercise the happy path.
  state.limitRows = [{ id: "claim-1" }];
  state.maxRows = [];
  state.lastInsertValues = undefined;
  state.lastConflictArgs = undefined;
  state.lastDoNothingArgs = undefined;
  state.lastUpdateSet = undefined;
  state.insertValuesLog = [];
  state.signedIn = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("castVote — lazy claim creation + one vote per user (#150)", () => {
  it("CREATES the claim for a (listing, attribute) with no claim row, then records the vote", async () => {
    // First-ever vote on an attribute: there is no claim row yet, so the write
    // path must materialize one before recording the attestation (#150). The
    // read-back resolves the new claim's id.
    state.limitRows = [{ id: "claim-new" }];

    await castVote({ listingId: "listing-1", attribute: "dedicated_fryer", value: "confirm" });

    // Two inserts in order: the lazy claim upsert, then the attestation upsert.
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(state.insertValuesLog[0]).toEqual({
      listingId: "listing-1",
      attribute: "dedicated_fryer",
    });
    // The claim upsert is `onConflictDoNothing` on the (listing, attribute)
    // unique constraint — idempotent, race-safe, never a duplicate claim.
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1);
    const doNothing = state.lastDoNothingArgs as { target: unknown[] };
    expect(doNothing.target).toHaveLength(2);

    // The attestation is upserted against the resolved claim id + the current user.
    expect(state.insertValuesLog[1]).toEqual({
      claimId: "claim-new",
      userId: "user-1",
      value: "confirm",
    });
    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(1);
    const args = state.lastConflictArgs as { target: unknown[]; set: Record<string, unknown> };
    expect(args.target).toHaveLength(2);
    expect(args.set.value).toBe("confirm");
    expect(args.set.updatedAt).toBeInstanceOf(Date);
  });

  it("changing a vote UPDATES the existing row rather than inserting a duplicate", async () => {
    // Same user votes twice on the same attribute: confirm then dispute. The
    // attestation always routes through insert+onConflictDoUpdate — never two
    // distinct rows. The DB's unique constraint is what makes the second an
    // update; we assert the code always routes through the upsert.
    await castVote({ listingId: "listing-1", attribute: "dedicated_fryer", value: "confirm" });
    await castVote({ listingId: "listing-1", attribute: "dedicated_fryer", value: "dispute" });

    // Two casts × (claim upsert + attestation upsert) = 4 `.values()` calls.
    expect(valuesMock).toHaveBeenCalledTimes(4);
    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(2);
    // Second cast carries the new value in both the insert and the update set.
    expect(state.lastInsertValues).toEqual({
      claimId: "claim-1",
      userId: "user-1",
      value: "dispute",
    });
    const args = state.lastConflictArgs as { set: Record<string, unknown> };
    expect(args.set.value).toBe("dispute");
  });

  it("requires a signed-in user (401 gate, impl not reached)", async () => {
    state.signedIn = false;
    await expect(
      castVote({ listingId: "listing-1", attribute: "dedicated_fryer", value: "confirm" })
    ).rejects.toThrow("Authentication required.");
    // No write happens when the gate rejects — not even the lazy claim create.
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rate-limits the authenticated user before any DB work (#18)", async () => {
    await castVote({ listingId: "listing-1", attribute: "dedicated_fryer", value: "confirm" });

    // The write is metered on the authenticated user's id, after auth, before DB.
    expect(enforceWriteLimitMock).toHaveBeenCalledTimes(1);
    expect(enforceWriteLimitMock).toHaveBeenCalledWith("user-1");
  });

  it("does not write when the rate limit is exceeded (429, impl not reached)", async () => {
    const tooFast = new HTTPException(429, { message: "too fast" });
    enforceWriteLimitMock.mockRejectedValueOnce(tooFast);

    await expect(
      castVote({ listingId: "listing-1", attribute: "dedicated_fryer", value: "confirm" })
    ).rejects.toBe(tooFast);
    // The limiter short-circuits before any DB work — no claim create, no vote.
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("castVote — lastConfirmedAt maintenance (recomputed from confirms)", () => {
  it("sets lastConfirmedAt to the newest surviving confirm on a confirm", async () => {
    // After the upsert there is one confirm row; its updatedAt is the recency.
    // The claim-id read-back precedes the MAX-recency read in the mock chain.
    const confirmedAt = new Date("2026-06-10T00:00:00Z");
    state.maxRows = [{ lastConfirmedAt: confirmedAt }];

    await castVote({ listingId: "listing-1", attribute: "dedicated_fryer", value: "confirm" });

    expect(updateMock).toHaveBeenCalledTimes(1);
    const set = state.lastUpdateSet as { lastConfirmedAt: Date | null; updatedAt: Date };
    expect(set.lastConfirmedAt).toEqual(confirmedAt);
    expect(set.updatedAt).toBeInstanceOf(Date);
  });

  it("clears lastConfirmedAt when a confirm is flipped to a dispute (no confirms remain)", async () => {
    // The user's only confirm becomes a dispute, so MAX over confirms is empty:
    // recency must drop to null rather than stay pinned to the withdrawn confirm.
    state.maxRows = [{ lastConfirmedAt: null }];

    await castVote({ listingId: "listing-1", attribute: "dedicated_fryer", value: "dispute" });

    // A dispute ALSO recomputes recency — preserved from #28.
    expect(updateMock).toHaveBeenCalledTimes(1);
    const set = state.lastUpdateSet as { lastConfirmedAt: Date | null; updatedAt: Date };
    expect(set.lastConfirmedAt).toBeNull();
    expect(set.updatedAt).toBeInstanceOf(Date);
  });

  it("keeps recency at the newest remaining confirm when others still confirm", async () => {
    // The actor disputes, but other users still confirm — recency holds at the
    // newest surviving confirm rather than clearing.
    const newest = new Date("2026-06-20T00:00:00Z");
    state.maxRows = [{ lastConfirmedAt: newest }];

    await castVote({ listingId: "listing-1", attribute: "dedicated_fryer", value: "dispute" });

    expect(updateMock).toHaveBeenCalledTimes(1);
    const set = state.lastUpdateSet as { lastConfirmedAt: Date | null };
    expect(set.lastConfirmedAt).toEqual(newest);
  });
});

describe("retractVote — deletes the user's row by (listing, attribute) + recomputes recency", () => {
  it("resolves the existing claim, then deletes the current user's attestation", async () => {
    state.limitRows = [{ id: "claim-1" }];

    await retractVote({ listingId: "listing-1", attribute: "dedicated_fryer" });

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteWhereMock).toHaveBeenCalledTimes(1);
    // Never CREATES a claim on retract (it is a delete-only path).
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("is a no-op when no claim row exists for the slot (never creates one)", async () => {
    // A retract on a never-attested attribute: there is no claim to resolve, so
    // we bail without deleting or recomputing — and crucially without an insert.
    state.limitRows = [];

    await retractVote({ listingId: "listing-1", attribute: "gf_substitutes" });

    expect(deleteMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("clears lastConfirmedAt when the retracted vote was the only confirm", async () => {
    // No confirm rows survive the delete, so MAX over confirms is empty.
    state.limitRows = [{ id: "claim-1" }];
    state.maxRows = [{ lastConfirmedAt: null }];

    await retractVote({ listingId: "listing-1", attribute: "dedicated_fryer" });

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledTimes(1);
    const set = state.lastUpdateSet as { lastConfirmedAt: Date | null; updatedAt: Date };
    expect(set.lastConfirmedAt).toBeNull();
    expect(set.updatedAt).toBeInstanceOf(Date);
  });

  it("leaves recency at the newest remaining confirm when others still confirm", async () => {
    // Retracting one of several confirms: recency drops to the newest survivor.
    state.limitRows = [{ id: "claim-1" }];
    const newest = new Date("2026-06-15T00:00:00Z");
    state.maxRows = [{ lastConfirmedAt: newest }];

    await retractVote({ listingId: "listing-1", attribute: "dedicated_fryer" });

    expect(updateMock).toHaveBeenCalledTimes(1);
    const set = state.lastUpdateSet as { lastConfirmedAt: Date | null };
    expect(set.lastConfirmedAt).toEqual(newest);
  });

  it("requires a signed-in user (401 gate, impl not reached)", async () => {
    state.signedIn = false;
    await expect(
      retractVote({ listingId: "listing-1", attribute: "dedicated_fryer" })
    ).rejects.toThrow("Authentication required.");
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("rate-limits the authenticated user before any DB work (#18)", async () => {
    await retractVote({ listingId: "listing-1", attribute: "dedicated_fryer" });

    expect(enforceWriteLimitMock).toHaveBeenCalledTimes(1);
    expect(enforceWriteLimitMock).toHaveBeenCalledWith("user-1");
  });

  it("does not delete when the rate limit is exceeded (429, impl not reached)", async () => {
    const tooFast = new HTTPException(429, { message: "too fast" });
    enforceWriteLimitMock.mockRejectedValueOnce(tooFast);

    await expect(
      retractVote({ listingId: "listing-1", attribute: "dedicated_fryer" })
    ).rejects.toBe(tooFast);
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
    state.limitRows = [{ moderationStatus: "visible", lastConfirmedAt: when }];

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
    state.limitRows = [{ moderationStatus: "visible", lastConfirmedAt: null }];

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

    // A missing claim is treated as not-found: zeroed aggregate, never counts.
    expect(agg.confirmCount).toBe(0);
    expect(agg.disputeCount).toBe(0);
    expect(agg.lastConfirmedAt).toBeNull();
  });

  it("does not require auth (reads are open)", async () => {
    state.signedIn = false; // would block a write, but reads must stay anonymous
    state.groupByRows = [{ value: "dispute", n: 3 }];
    state.limitRows = [{ moderationStatus: "visible", lastConfirmedAt: null }];

    const agg = await getClaimAggregate({ claimId: "claim-1" });

    expect(agg.disputeCount).toBe(3);
    expect(requireCurrentUserMock).not.toHaveBeenCalled();
  });

  // --- #41: a hidden/removed claim must NOT leak its trust roll-up ----------
  it("returns the ZEROED aggregate for a HIDDEN claim — never its counts (#41, ADR-007)", async () => {
    // The DB has real attestations, but the claim is hidden. The public read
    // must NOT expose them: it bails on visibility BEFORE scanning attestations.
    state.groupByRows = [
      { value: "confirm", n: 9 },
      { value: "dispute", n: 0 },
    ];
    state.limitRows = [
      { moderationStatus: "hidden", lastConfirmedAt: new Date("2026-06-01T00:00:00Z") },
    ];

    const agg = await getClaimAggregate({ claimId: "claim-hidden" });

    expect(agg).toEqual({
      claimId: "claim-hidden",
      confirmCount: 0,
      disputeCount: 0,
      lastConfirmedAt: null,
    });
    // No attestation scan happened — the visibility gate short-circuited first.
    expect(h.groupByMock).not.toHaveBeenCalled();
  });

  it("returns the ZEROED aggregate for a REMOVED claim", async () => {
    state.groupByRows = [{ value: "confirm", n: 4 }];
    state.limitRows = [
      { moderationStatus: "removed", lastConfirmedAt: new Date("2026-06-01T00:00:00Z") },
    ];

    const agg = await getClaimAggregate({ claimId: "claim-removed" });

    expect(agg).toEqual({
      claimId: "claim-removed",
      confirmCount: 0,
      disputeCount: 0,
      lastConfirmedAt: null,
    });
  });
});
