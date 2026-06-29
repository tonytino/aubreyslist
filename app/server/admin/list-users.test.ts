import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "~/db/schema";

/**
 * Tests for the admin-only user directory (`listUsers`, #142).
 *
 * `listUsers` is the lookup the role-management UI calls to find an account to
 * promote/demote. It is admin-only data, so the gate is the thing under test:
 * we drive the REAL `requireCurrentRole("admin")` guard through a mocked
 * current-user accessor (so we exercise the actual 401/403 policy, not a stubbed
 * one) and assert the four access branches:
 *
 *   no user            → 401 (no DB read)
 *   role "user"        → 403 (no DB read)
 *   role "moderator"   → 403 (no DB read — moderators get the queue, NOT the directory)
 *   role "admin"       → returns the minimal id/email/name/role rows
 *
 * The DB is mocked (per `docs/agents/testing.md`, minimal mocking) so no live
 * connection is needed; the admin case asserts the projection is issued and the
 * rows flow back. The moderator case is the leak guard: the directory must never
 * be read for a role that may not see it.
 */

// --- Mocks -----------------------------------------------------------------
// `listUsers` uses the real `requireCurrentRole` guard, which resolves the
// caller via `getCurrentUser`; mock only that accessor so the genuine role
// policy runs. The DB SELECT chain (select -> from -> orderBy -> limit) is
// mocked to a Promise of staged rows.
const h = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  rows: [] as unknown[],
  limitMock: vi.fn(),
  orderByMock: vi.fn(),
  fromMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("~/server/auth/current-user", () => ({
  getCurrentUser: h.getCurrentUserMock,
}));

vi.mock("~/db/client", () => ({
  getDb: () => ({ select: h.selectMock }),
}));

import { listUsers } from "./list-users";

const { getCurrentUserMock, selectMock } = h;

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
  h.rows = [];
  // select(...).from(...).orderBy(...).limit(...) resolves to the staged rows.
  h.limitMock.mockImplementation(() => Promise.resolve(h.rows));
  h.orderByMock.mockImplementation(() => ({ limit: h.limitMock }));
  h.fromMock.mockImplementation(() => ({ orderBy: h.orderByMock }));
  h.selectMock.mockImplementation(() => ({ from: h.fromMock }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("listUsers — admin-only user directory (ADR-010)", () => {
  it("rejects an anonymous caller with 401 (no DB read)", async () => {
    getCurrentUserMock.mockResolvedValue(null);

    await expect(listUsers()).rejects.toMatchObject({ status: 401 });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("forbids a plain 'user' caller with 403 (no DB read)", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("user"));

    await expect(listUsers()).rejects.toMatchObject({ status: 403 });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("forbids a 'moderator' caller with 403 (directory is admin-only, no DB read)", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("moderator"));

    await expect(listUsers()).rejects.toMatchObject({ status: 403 });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns the directory rows for an admin", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("admin"));
    h.rows = [
      { id: "u1", email: "a@example.com", name: "Ada", role: "admin" },
      { id: "u2", email: "m@example.com", name: "Mo", role: "moderator" },
      { id: "u3", email: "z@example.com", name: "Zed", role: "user" },
    ];

    const result = await listUsers();

    expect(result).toEqual(h.rows);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("selects EXACTLY the minimal projection — no sensitive columns leak (id/email/name/role)", async () => {
    // This directory exists precisely to avoid exposing sensitive columns, so
    // the projection is part of its contract. Pin it: widening the `.select(...)`
    // — especially to `googleSub` (an auth identity anchor) or `avatarUrl` — must
    // FAIL here. The select arg is the column-projection object passed to drizzle.
    getCurrentUserMock.mockResolvedValue(userRow("admin"));
    h.rows = [{ id: "u1", email: "a@example.com", name: "Ada", role: "admin" }];

    await listUsers();

    const projection = selectMock.mock.calls[0]?.[0];
    expect(projection).toBeDefined();
    const columns = Object.keys(projection as Record<string, unknown>);
    // Exactly these four, in this order — nothing more, nothing less.
    expect(columns).toEqual(["id", "email", "name", "role"]);
    // Belt-and-braces: the sensitive columns are explicitly absent.
    expect(columns).not.toContain("googleSub");
    expect(columns).not.toContain("avatarUrl");
  });

  it("surfaces the guard's HTTPException type for forbidden callers", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("user"));
    await expect(listUsers()).rejects.toBeInstanceOf(HTTPException);
  });
});
