import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "~/db/schema";

/**
 * Tests for the admin-panel access gate (`resolveAdminView`, #38).
 *
 * `resolveAdminView` (in the server-only `admin-view` module) is the logic
 * behind the `fetchAdminView` server fn and the ADR-010 security boundary for
 * `/admin`: the guard decision happens
 * server-side off the authoritative `users` row, and settings
 * are admin-only data. We mock its two server-only collaborators — the
 * current-user accessor and the settings reader — so we can assert all four
 * access branches without cookie/DB plumbing, per `docs/agents/testing.md`
 * (minimal mocking). The branches:
 *
 *   no user            → { access: "anonymous" }              (getSetting unused)
 *   role "user"        → { access: "forbidden" }              (getSetting unused)
 *   role "moderator"   → granted, settings: null              (getSetting NOT called)
 *   role "admin"       → granted, populated settings          (both keys read)
 *
 * The moderator case is the leak guard: settings must never be fetched (let
 * alone exposed) for a role that does not see the settings section.
 */

// --- Mocks -----------------------------------------------------------------
// The module's only server-only deps are the current-user accessor and the
// settings reader. Both mocks live in `vi.hoisted` so the (hoisted) `vi.mock`
// factories can close over them.
const h = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  getSettingMock: vi.fn(),
}));

vi.mock("~/server/auth/current-user", () => ({
  getCurrentUser: h.getCurrentUserMock,
}));

vi.mock("~/server/settings", () => ({
  getSetting: (key: string) => h.getSettingMock(key),
}));

import { resolveAdminView } from "./admin-view";

const { getCurrentUserMock, getSettingMock } = h;

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
  // Settings reads resolve per key; the moderator/anonymous/forbidden cases
  // assert this is never invoked.
  getSettingMock.mockImplementation((key: string) =>
    Promise.resolve(key === "intake_mode" ? "places" : 6)
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("fetchAdminView — server-side access gate (ADR-010)", () => {
  it("reports anonymous when there is no current user (no settings read)", async () => {
    getCurrentUserMock.mockResolvedValue(null);

    const view = await resolveAdminView();

    expect(view).toEqual({ access: "anonymous" });
    // Access is denied before any admin-only data is touched.
    expect(getSettingMock).not.toHaveBeenCalled();
  });

  it("forbids a plain 'user' role (no settings read)", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("user"));

    const view = await resolveAdminView();

    expect(view).toEqual({ access: "forbidden" });
    expect(getSettingMock).not.toHaveBeenCalled();
  });

  it("grants a moderator WITHOUT fetching settings (leak guard)", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("moderator"));

    const view = await resolveAdminView();

    expect(view).toEqual({ access: "granted", role: "moderator", settings: null });
    // Settings are admin-only data: a moderator must never trigger the read.
    expect(getSettingMock).not.toHaveBeenCalled();
  });

  it("grants an admin with populated settings (both keys read)", async () => {
    getCurrentUserMock.mockResolvedValue(userRow("admin"));

    const view = await resolveAdminView();

    expect(view).toEqual({
      access: "granted",
      role: "admin",
      settings: { intakeMode: "places", stalenessMonths: 6 },
    });
    // Both settings keys backing the read-only settings section are read.
    expect(getSettingMock).toHaveBeenCalledTimes(2);
    expect(getSettingMock).toHaveBeenCalledWith("intake_mode");
    expect(getSettingMock).toHaveBeenCalledWith("staleness_months");
  });
});
