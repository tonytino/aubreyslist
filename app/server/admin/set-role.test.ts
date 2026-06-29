import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "~/db/schema";
import type { Role } from "~/server/auth/guards";

/**
 * Tests for the admin-only role-management logic (`setRole`, #16, #127).
 *
 * `setRole` is the ADR-010 security boundary for promoting/demoting moderators:
 * the gate is enforced server-side off the authoritative `users` row, never the
 * UI. The bulk of these tests pin down that PERMISSION BOUNDARY — anonymous,
 * `user`, and `moderator` callers must all be rejected, and only an `admin` may
 * write — by driving the real `requireCurrentRole` guard through a mocked
 * current-user accessor (so we exercise the actual 401/403 policy, not a stubbed
 * one). The DB is mocked, so no live connection is needed; we assert the correct
 * `UPDATE users SET role = ... WHERE id = userId` is issued and the 404 / Zod
 * rejection paths behave, per `docs/agents/testing.md` (minimal mocking).
 *
 * The last-admin guard (#127) reads two `SELECT`s before any write: the target's
 * current role (SELECT #1), then a count of the OTHER admins (SELECT #2). The
 * first is staged FIFO via {@link stageSelects}. The second is NOT a hardcoded
 * scalar — that would let a mutation dropping `ne(users.id, userId)` from the
 * source slip through, the exact regression #127 prevents. Instead the count
 * mock reads the bound parameter values out of the REAL drizzle predicate the
 * source built ({@link boundParamValues}) and counts a staged "admin universe"
 * of rows, EXCLUDING any whose `id` is bound in the predicate. So if the source
 * keeps `ne(users.id, userId)`, the target's own id is bound and excluded; if a
 * mutant drops it, the id is no longer bound, the target counts itself, and the
 * sole-admin self-demotion test below flips from blocked to allowed and FAILS.
 * By default the target is a plain `moderator`, so the guard is a no-op and the
 * existing #16 expectations are unaffected.
 */

// --- Mocks -----------------------------------------------------------------
// `setRole` uses the real `requireCurrentRole` guard, which resolves the caller
// via `getCurrentUser`; mock only that accessor so the genuine role policy runs.
const h = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  // db.select(...).from(...).where(predicate)
  //   SELECT #1 (target lookup): drains `selectResults` FIFO.
  //   SELECT #2 (admin count): derived from `adminUniverse` filtered by the
  //   predicate's bound param ids — see the module doc.
  selectResults: [] as unknown[][],
  adminUniverse: [] as { id: string }[],
  selectCallCount: { n: 0 },
  selectWhereMock: vi.fn(),
  selectFromMock: vi.fn(),
  selectMock: vi.fn(),
  // db.update(...).set(...).where(...).returning()
  returningMock: vi.fn<() => Promise<User[]>>(),
  whereMock: vi.fn(),
  setMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("~/server/auth/current-user", () => ({
  getCurrentUser: h.getCurrentUserMock,
}));

vi.mock("~/db/client", () => ({
  getDb: () => ({ select: h.selectMock, update: h.updateMock }),
}));

import { setRole } from "./set-role";

const {
  getCurrentUserMock,
  selectResults,
  adminUniverse,
  selectCallCount,
  selectWhereMock,
  selectFromMock,
  selectMock,
  returningMock,
  whereMock,
  setMock,
  updateMock,
} = h;

/**
 * Walk a drizzle predicate (the `SQL` object returned by `and(eq(...), ne(...))`)
 * and collect every BOUND parameter value (the values live in `Param` chunks
 * nested under `queryChunks`). This lets the count mock see exactly which values
 * the source bound — so if `ne(users.id, userId)` is dropped, `userId` no longer
 * appears here and the self-exclusion stops taking effect.
 */
function boundParamValues(node: unknown, out: unknown[] = []): unknown[] {
  if (!node || typeof node !== "object") return out;
  const rec = node as Record<string, unknown>;
  // A `Param` chunk carries the literal bound value.
  if (rec.constructor?.name === "Param" && "value" in rec) {
    out.push(rec.value);
  }
  if (Array.isArray(rec.queryChunks)) {
    for (const chunk of rec.queryChunks) boundParamValues(chunk, out);
  }
  return out;
}

// --- Fixtures --------------------------------------------------------------

function userRow(role: User["role"], overrides: Partial<User> = {}): User {
  return {
    id: `user-${role}`,
    googleSub: `sub-${role}`,
    email: `${role}@example.com`,
    name: role,
    avatarUrl: null,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

/**
 * Stage the target-lookup SELECT (#1). Each entry feeds one `db.select()...
 * .where()`; in practice the guard issues at most one target lookup per call.
 */
function stageSelects(...results: unknown[][]) {
  selectResults.length = 0;
  selectResults.push(...results);
}

/**
 * Stage the "admin universe" the count SELECT (#2) draws from: the full set of
 * admin rows that exist. The count mock applies the source's own predicate
 * (excluding ids it bound) to derive the scalar, so the `ne(users.id, userId)`
 * self-exclusion is genuinely exercised rather than hardcoded.
 */
function stageAdminUniverse(...ids: string[]) {
  adminUniverse.length = 0;
  adminUniverse.push(...ids.map((id) => ({ id })));
}

beforeEach(() => {
  selectCallCount.n = 0;
  // Wire the drizzle SELECT chain. The FIRST `.where()` is the target lookup
  // (FIFO-staged). The SECOND is the admin count: derive the scalar from the
  // staged admin universe minus any ids the source bound into the predicate
  // (i.e. honoring `ne(users.id, userId)`), so dropping that clause is caught.
  selectWhereMock.mockImplementation((predicate: unknown) => {
    selectCallCount.n += 1;
    if (selectCallCount.n === 1) {
      return Promise.resolve(selectResults.shift() ?? []);
    }
    const excluded = new Set(boundParamValues(predicate).filter((v) => typeof v === "string"));
    const value = adminUniverse.filter((a) => !excluded.has(a.id)).length;
    return Promise.resolve([{ value }]);
  });
  selectFromMock.mockImplementation(() => ({ where: selectWhereMock }));
  selectMock.mockImplementation(() => ({ from: selectFromMock }));
  // Default: target is a plain moderator, so the last-admin guard is a no-op.
  stageSelects([{ role: "moderator" }]);
  stageAdminUniverse();

  // Wire the drizzle UPDATE chain; `returningResult` is set per-test.
  whereMock.mockImplementation(() => ({ returning: returningMock }));
  setMock.mockImplementation(() => ({ where: whereMock }));
  updateMock.mockImplementation(() => ({ set: setMock }));
  returningMock.mockResolvedValue([userRow("moderator", { id: "target-1" })]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("setRole — admin-only role management (ADR-010)", () => {
  // --- Permission boundary -------------------------------------------------

  it("rejects an anonymous caller with 401 (no DB write)", async () => {
    getCurrentUserMock.mockResolvedValue(null);

    await expect(setRole({ userId: "target-1", role: "moderator" })).rejects.toMatchObject({
      status: 401,
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("forbids a plain 'user' caller with 403 (no DB write)", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("user"));

    await expect(setRole({ userId: "target-1", role: "moderator" })).rejects.toMatchObject({
      status: 403,
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("forbids a 'moderator' caller with 403 (role mgmt is admin-only, no DB write)", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("moderator"));

    await expect(setRole({ userId: "target-1", role: "moderator" })).rejects.toMatchObject({
      status: 403,
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("allows an admin to grant the moderator role, issuing the correct update", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("admin"));
    const target = userRow("moderator", { id: "target-1" });
    returningMock.mockResolvedValue([target]);

    const result = await setRole({ userId: "target-1", role: "moderator" });

    expect(result).toEqual({ user: target });
    expect(updateMock).toHaveBeenCalledTimes(1);
    // SET role = 'moderator' (+ bump updatedAt)
    expect(setMock).toHaveBeenCalledTimes(1);
    const setArg = setMock.mock.calls[0]?.[0] as { role: Role; updatedAt: Date };
    expect(setArg.role).toBe("moderator");
    expect(setArg.updatedAt).toBeInstanceOf(Date);
    // WHERE id = userId — one targeted update.
    expect(whereMock).toHaveBeenCalledTimes(1);
  });

  it("allows an admin to revoke (set role back to 'user')", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("admin"));
    const target = userRow("user", { id: "target-1" });
    returningMock.mockResolvedValue([target]);

    const result = await setRole({ userId: "target-1", role: "user" });

    expect(result).toEqual({ user: target });
    expect((setMock.mock.calls[0]?.[0] as { role: Role }).role).toBe("user");
  });

  // --- Last-admin guard (#127) ---------------------------------------------

  it("rejects demoting the LAST admin with 409 (no DB write)", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("admin"));
    // Target is an admin; the only admin in existence is the target itself, so
    // the `ne(users.id, userId)` self-exclusion leaves ZERO others.
    stageSelects([{ role: "admin" }]);
    stageAdminUniverse("last-admin");

    await expect(setRole({ userId: "last-admin", role: "moderator" })).rejects.toMatchObject({
      status: 409,
    });
    expect(updateMock).not.toHaveBeenCalled();
    // The count query actually ran on the admin-demote path (guards the guard).
    expect(selectWhereMock).toHaveBeenCalledTimes(2);
  });

  it("allows demoting a NON-last admin (another admin remains), issuing the update", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("admin"));
    // Target is an admin; a SECOND admin exists ⇒ one OTHER remains after the
    // self-exclusion ⇒ safe to demote.
    stageSelects([{ role: "admin" }]);
    stageAdminUniverse("demote-me", "other-admin");
    const target = userRow("moderator", { id: "demote-me" });
    returningMock.mockResolvedValue([target]);

    const result = await setRole({ userId: "demote-me", role: "moderator" });

    expect(result).toEqual({ user: target });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect((setMock.mock.calls[0]?.[0] as { role: Role }).role).toBe("moderator");
    expect(selectWhereMock).toHaveBeenCalledTimes(2);
  });

  it("allows an admin to self-demote when NOT the last admin", async () => {
    const me = userRow("admin", { id: "me" });
    getCurrentUserMock.mockResolvedValue(me);
    // Target (me) is an admin; another admin exists ⇒ stepping down is allowed.
    stageSelects([{ role: "admin" }]);
    stageAdminUniverse("me", "other-admin");
    const target = userRow("user", { id: "me" });
    returningMock.mockResolvedValue([target]);

    const result = await setRole({ userId: "me", role: "user" });

    expect(result).toEqual({ user: target });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect((setMock.mock.calls[0]?.[0] as { role: Role }).role).toBe("user");
  });

  it("BLOCKS a sole admin from self-demoting — fails if `ne(users.id, userId)` is dropped", async () => {
    // The mutation #127 must catch: if the source stops excluding the target
    // from the OTHER-admin count, a sole admin counts themselves (1 ≥ 1), the
    // guard never fires, the self-demote write goes through, and the app locks
    // itself out of administration. Here the ONLY admin is the caller demoting
    // themselves: with the self-exclusion the count is 0 ⇒ 409 (no write); drop
    // it and the count becomes 1 ⇒ this expectation fails.
    const me = userRow("admin", { id: "me" });
    getCurrentUserMock.mockResolvedValue(me);
    stageSelects([{ role: "admin" }]);
    stageAdminUniverse("me"); // the target is the one and only admin

    await expect(setRole({ userId: "me", role: "user" })).rejects.toMatchObject({
      status: 409,
    });
    expect(updateMock).not.toHaveBeenCalled();
    expect(selectWhereMock).toHaveBeenCalledTimes(2);
  });

  // --- Not found -----------------------------------------------------------

  it("throws 404 when the target user does not exist", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("admin"));
    stageSelects([]); // target lookup finds no row ⇒ guard is a no-op
    returningMock.mockResolvedValue([]); // empty returning ⇒ no row matched

    await expect(setRole({ userId: "missing", role: "moderator" })).rejects.toMatchObject({
      status: 404,
    });
  });

  // --- Zod validation ------------------------------------------------------

  it("rejects an out-of-range role like 'admin' (cannot mint admins)", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("admin"));

    // `admin` is not an assignable role — cast through unknown to feed the
    // invalid value past the compile-time type without an `any`.
    await expect(
      setRole({ userId: "target-1", role: "admin" } as unknown as Parameters<typeof setRole>[0])
    ).rejects.toThrow();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects an empty userId", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("admin"));

    await expect(setRole({ userId: "", role: "moderator" })).rejects.toThrow();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only userId (trimmed to empty)", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("admin"));

    await expect(setRole({ userId: "   ", role: "moderator" })).rejects.toThrow();
    expect(updateMock).not.toHaveBeenCalled();
  });
});

// A small sanity check that the guard, not a stubbed mock, produces the codes —
// keeps the boundary honest if the guard's implementation ever changes.
describe("setRole — guard wiring", () => {
  it("surfaces the guard's HTTPException type for forbidden callers", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("user"));
    await expect(setRole({ userId: "target-1", role: "moderator" })).rejects.toBeInstanceOf(
      HTTPException
    );
  });
});
