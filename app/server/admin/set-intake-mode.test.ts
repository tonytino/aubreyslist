import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "~/db/schema";

/**
 * Tests for the admin-only intake-mode toggle logic (`setIntakeMode`, #24).
 *
 * Flipping the active listing-intake mode is the ADR-008 admin power and an
 * ADR-010 security boundary: the gate is enforced server-side off the
 * authoritative `users` row, never the UI. These tests pin down that PERMISSION
 * BOUNDARY — anonymous (401), `user` (403), and `moderator` (403) callers must
 * all be rejected with NO write, and only an `admin` may persist — by driving
 * the real `requireCurrentRole` guard through a mocked current-user accessor (so
 * we exercise the genuine 401/403 policy, not a stub). `setSetting` is mocked,
 * so no live DB is needed; we assert the correct `setSetting("intake_mode", ...)`
 * call and that an invalid mode is rejected by Zod before any write, per
 * `docs/agents/testing.md` (minimal mocking).
 */

// --- Mocks -----------------------------------------------------------------
// `setIntakeMode` uses the real `requireCurrentRole` guard, which resolves the
// caller via `getCurrentUser`; mock only that accessor so the genuine role
// policy runs. `setSetting` is mocked to assert the write without a live DB.
const h = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  setSettingMock: vi.fn<() => Promise<void>>(),
}));

vi.mock("~/server/auth/current-user", () => ({
  getCurrentUser: h.getCurrentUserMock,
}));

vi.mock("~/server/settings", async (importOriginal) => {
  // Keep the real registry (INTAKE_MODES etc.) so the Zod schema derives its
  // allowed values from the genuine source; mock only the db-touching writer.
  const actual = await importOriginal<typeof import("~/server/settings")>();
  return { ...actual, setSetting: h.setSettingMock };
});

import { setIntakeMode } from "./set-intake-mode";

const { getCurrentUserMock, setSettingMock } = h;

// --- Fixtures --------------------------------------------------------------

function userRow(role: User["role"]): User {
  return {
    id: `user-${role}`,
    googleSub: `sub-${role}`,
    email: `${role}@example.com`,
    name: role,
    avatarUrl: null,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;
}

beforeEach(() => {
  setSettingMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("setIntakeMode — admin-only intake toggle (ADR-008 / ADR-010)", () => {
  // --- Permission boundary -------------------------------------------------

  it("rejects an anonymous caller with 401 (no write)", async () => {
    getCurrentUserMock.mockResolvedValue(null);

    await expect(setIntakeMode({ mode: "manual" })).rejects.toMatchObject({ status: 401 });
    expect(setSettingMock).not.toHaveBeenCalled();
  });

  it("forbids a plain 'user' caller with 403 (no write)", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("user"));

    await expect(setIntakeMode({ mode: "manual" })).rejects.toMatchObject({ status: 403 });
    expect(setSettingMock).not.toHaveBeenCalled();
  });

  it("forbids a 'moderator' caller with 403 (settings are admin-only, no write)", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("moderator"));

    await expect(setIntakeMode({ mode: "manual" })).rejects.toMatchObject({ status: 403 });
    expect(setSettingMock).not.toHaveBeenCalled();
  });

  it("surfaces the guard's HTTPException type for forbidden callers", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("moderator"));

    await expect(setIntakeMode({ mode: "manual" })).rejects.toBeInstanceOf(HTTPException);
  });

  // --- Admin success -------------------------------------------------------

  it("allows an admin to switch to 'manual', issuing the correct setSetting call", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("admin"));

    const result = await setIntakeMode({ mode: "manual" });

    expect(result).toEqual({ intakeMode: "manual" });
    expect(setSettingMock).toHaveBeenCalledTimes(1);
    expect(setSettingMock).toHaveBeenCalledWith("intake_mode", "manual");
  });

  it("allows an admin to switch back to 'places'", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("admin"));

    const result = await setIntakeMode({ mode: "places" });

    expect(result).toEqual({ intakeMode: "places" });
    expect(setSettingMock).toHaveBeenCalledWith("intake_mode", "places");
  });

  // --- Zod validation ------------------------------------------------------

  it("rejects an out-of-range mode like 'csv' (no write)", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("admin"));

    // `csv` is not a member of INTAKE_MODES — cast through unknown to feed the
    // invalid value past the compile-time type without an `any`.
    await expect(
      setIntakeMode({ mode: "csv" } as unknown as Parameters<typeof setIntakeMode>[0])
    ).rejects.toThrow();
    expect(setSettingMock).not.toHaveBeenCalled();
  });
});
