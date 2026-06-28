import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "~/db/schema";
import type { Role } from "~/server/auth/guards";

/**
 * Tests for the admin-only role-management logic (`setRole`, #16).
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
 */

// --- Mocks -----------------------------------------------------------------
// `setRole` uses the real `requireCurrentRole` guard, which resolves the caller
// via `getCurrentUser`; mock only that accessor so the genuine role policy runs.
const h = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
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
  getDb: () => ({ update: h.updateMock }),
}));

import { setRole } from "./set-role";

const { getCurrentUserMock, returningMock, whereMock, setMock, updateMock } = h;

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

beforeEach(() => {
  // Wire the drizzle update chain; `returningResult` is set per-test.
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

  // --- Not found -----------------------------------------------------------

  it("throws 404 when the target user does not exist", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("admin"));
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
