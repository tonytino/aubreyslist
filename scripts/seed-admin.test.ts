import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "~/db/schema";
import {
  InvalidEmailArgError,
  type SeedAdminDb,
  USAGE,
  UserNotFoundError,
  runCli,
  seedAdmin,
} from "./seed-admin";

/**
 * Tests for the first-admin seeding CLI (`pnpm db:seed-admin`, #128).
 *
 * The DB is injected as a dependency (no `~/db/client` import to mock), so these
 * exercise the real lookup/promote/idempotent/not-found/misuse branches with a
 * hand-built drizzle chain mock — the same `update().set().where().returning()`
 * shape `set-role.test.ts` mocks, plus `query.users.findFirst`. No live
 * connection and no `DATABASE_URL` are needed.
 */

// --- Drizzle chain mock ----------------------------------------------------

const h = vi.hoisted(() => ({
  findFirstMock: vi.fn<() => Promise<User | undefined>>(),
  returningMock: vi.fn<() => Promise<User[]>>(),
  whereMock: vi.fn(),
  setMock: vi.fn(),
  updateMock: vi.fn(),
}));

const { findFirstMock, returningMock, whereMock, setMock, updateMock } = h;

function makeDb(): SeedAdminDb {
  return {
    query: { users: { findFirst: findFirstMock } },
    update: updateMock,
  } as unknown as SeedAdminDb;
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

beforeEach(() => {
  whereMock.mockImplementation(() => ({ returning: returningMock }));
  setMock.mockImplementation(() => ({ where: whereMock }));
  updateMock.mockImplementation(() => ({ set: setMock }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("seedAdmin — core promote logic", () => {
  it("promotes an existing non-admin user, updating role to 'admin' WHERE email", async () => {
    const before = userRow("user", { email: "owner@example.com" });
    const after = { ...before, role: "admin" as const };
    findFirstMock.mockResolvedValue(before);
    returningMock.mockResolvedValue([after]);

    const result = await seedAdmin("owner@example.com", { db: makeDb() });

    expect(result.status).toBe("promoted");
    expect(result.user.role).toBe("admin");
    // SET role = 'admin' (+ bump updatedAt)
    expect(setMock).toHaveBeenCalledTimes(1);
    const setArg = setMock.mock.calls[0]?.[0] as { role: string; updatedAt: Date };
    expect(setArg.role).toBe("admin");
    expect(setArg.updatedAt).toBeInstanceOf(Date);
    // One targeted update; WHERE matches the (looked-up + updated) email.
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(whereMock).toHaveBeenCalledTimes(1);
  });

  it("trims the email before lookup and update", async () => {
    findFirstMock.mockResolvedValue(userRow("user"));
    returningMock.mockResolvedValue([userRow("admin")]);

    const result = await seedAdmin("  owner@example.com  ", { db: makeDb() });

    expect(result.message).toContain("owner@example.com");
    expect(result.message).not.toContain("  owner");
  });

  it("is idempotent: an already-admin user is a no-op success (no UPDATE)", async () => {
    findFirstMock.mockResolvedValue(userRow("admin", { email: "owner@example.com" }));

    const result = await seedAdmin("owner@example.com", { db: makeDb() });

    expect(result.status).toBe("noop");
    expect(result.message).toMatch(/already an admin/i);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws UserNotFoundError (never inserts) when no row matches", async () => {
    findFirstMock.mockResolvedValue(undefined);

    await expect(seedAdmin("ghost@example.com", { db: makeDb() })).rejects.toBeInstanceOf(
      UserNotFoundError
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects an empty / whitespace email with InvalidEmailArgError (no DB touch)", async () => {
    await expect(seedAdmin("   ", { db: makeDb() })).rejects.toBeInstanceOf(InvalidEmailArgError);
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("runCli — thin arg/exit shell", () => {
  function makeLog() {
    return { log: vi.fn(), error: vi.fn() };
  }

  it("returns 0 and prints success on promote", async () => {
    findFirstMock.mockResolvedValue(userRow("user", { email: "owner@example.com" }));
    returningMock.mockResolvedValue([userRow("admin", { email: "owner@example.com" })]);
    const log = makeLog();

    const code = await runCli(["owner@example.com"], { db: makeDb() }, log);

    expect(code).toBe(0);
    expect(log.log).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("returns 0 on already-admin (idempotent success)", async () => {
    findFirstMock.mockResolvedValue(userRow("admin", { email: "owner@example.com" }));
    const log = makeLog();

    const code = await runCli(["owner@example.com"], { db: makeDb() }, log);

    expect(code).toBe(0);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 2 with usage when the email arg is missing", async () => {
    const log = makeLog();

    const code = await runCli([], { db: makeDb() }, log);

    expect(code).toBe(2);
    expect(log.error).toHaveBeenCalledWith(USAGE);
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("returns 2 with usage when the email arg is blank", async () => {
    const log = makeLog();

    const code = await runCli(["   "], { db: makeDb() }, log);

    expect(code).toBe(2);
    expect(log.error).toHaveBeenCalledWith(USAGE);
  });

  it("returns 1 with an actionable message when the user is not found", async () => {
    findFirstMock.mockResolvedValue(undefined);
    const log = makeLog();

    const code = await runCli(["ghost@example.com"], { db: makeDb() }, log);

    expect(code).toBe(1);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0]?.[0]).toMatch(/sign in once/i);
  });

  it("returns 1 on an unexpected DB error", async () => {
    findFirstMock.mockRejectedValue(new Error("connection refused"));
    const log = makeLog();

    const code = await runCli(["owner@example.com"], { db: makeDb() }, log);

    expect(code).toBe(1);
    expect(log.error).toHaveBeenCalledWith("connection refused");
  });
});
