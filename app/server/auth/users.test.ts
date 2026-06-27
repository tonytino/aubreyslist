import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleUserInfo } from "./google";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://user:pass@host/db";
});

// Mock the DB client: the upsert logic (find → insert-or-update keyed on
// google_sub) is what we verify, not Drizzle/Neon itself.
const findFirst = vi.fn();
const returningInsert = vi.fn();
const returningUpdate = vi.fn();
// Capture the values passed to insert(...).values(...) so tests can assert on
// the persisted payload without reaching into nested mock.results.
const insertValues = vi.fn((_values: Record<string, unknown>) => ({ returning: returningInsert }));
const setValues = vi.fn((_values: Record<string, unknown>) => ({
  where: vi.fn(() => ({ returning: returningUpdate })),
}));

const db = {
  query: { users: { findFirst } },
  insert: vi.fn(() => ({ values: insertValues })),
  update: vi.fn(() => ({ set: setValues })),
};

vi.mock("~/db/client", () => ({ getDb: () => db }));

const { upsertUserFromGoogle } = await import("./users");

const profile: GoogleUserInfo = {
  sub: "google-sub-xyz",
  email: "person@example.com",
  email_verified: true,
  name: "Person Example",
  picture: "https://example.com/avatar.png",
};

beforeEach(() => {
  findFirst.mockReset();
  returningInsert.mockReset();
  returningUpdate.mockReset();
  db.insert.mockClear();
  db.update.mockClear();
  insertValues.mockClear();
  setValues.mockClear();
});

describe("upsertUserFromGoogle", () => {
  it("creates a new user (role defaults to user) on first sign-in", async () => {
    findFirst.mockResolvedValue(undefined);
    returningInsert.mockResolvedValue([{ id: "new-id", googleSub: profile.sub, role: "user" }]);

    const user = await upsertUserFromGoogle(profile);

    expect(user.id).toBe("new-id");
    // Looked up by google_sub, then inserted (no role passed → DB default).
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.update).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ googleSub: "google-sub-xyz", email: "person@example.com" })
    );
    expect(insertValues.mock.calls[0]?.[0]).not.toHaveProperty("role");
  });

  it("resolves a returning user to the existing row (keyed on google_sub)", async () => {
    findFirst.mockResolvedValue({ id: "existing-id", googleSub: profile.sub, role: "moderator" });
    returningUpdate.mockResolvedValue([
      { id: "existing-id", googleSub: profile.sub, role: "moderator" },
    ]);

    const user = await upsertUserFromGoogle(profile);

    expect(user.id).toBe("existing-id");
    // Updated, never inserted — and role is untouched (a promotion survives).
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(user.role).toBe("moderator");
  });

  it("falls back to email when Google omits a name", async () => {
    findFirst.mockResolvedValue(undefined);
    returningInsert.mockResolvedValue([{ id: "n", role: "user" }]);

    await upsertUserFromGoogle({ ...profile, name: undefined });

    expect(insertValues.mock.calls[0]?.[0]).toMatchObject({ name: "person@example.com" });
  });
});
