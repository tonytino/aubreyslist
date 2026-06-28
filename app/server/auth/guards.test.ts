import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "~/db/schema";

// The async wrappers resolve the ambient session through getCurrentUser; mock
// it so we exercise the guard logic, not cookie/DB plumbing (covered elsewhere).
const getCurrentUser = vi.fn();
vi.mock("./current-user", () => ({ getCurrentUser: () => getCurrentUser() }));

const { requireUser, requireRole, requireCurrentUser, requireCurrentRole } = await import(
  "./guards"
);

/** Build a minimal `users` row at the given role for guard assertions. */
function userAt(role: User["role"]): User {
  return {
    id: `id-${role}`,
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
  getCurrentUser.mockReset();
});

describe("requireUser", () => {
  it("returns the user when authenticated", () => {
    const user = userAt("user");
    expect(requireUser(user)).toBe(user);
  });

  it("throws 401 when anonymous", () => {
    expect(() => requireUser(null)).toThrow(HTTPException);
    try {
      requireUser(null);
    } catch (err) {
      expect((err as HTTPException).status).toBe(401);
    }
  });
});

describe("requireRole", () => {
  it("admits the exact role", () => {
    const mod = userAt("moderator");
    expect(requireRole("moderator", mod)).toBe(mod);
  });

  it("admits a higher role (admin satisfies a moderator requirement)", () => {
    const admin = userAt("admin");
    expect(requireRole("moderator", admin)).toBe(admin);
  });

  it("rejects a lower role with 403", () => {
    try {
      requireRole("moderator", userAt("user"));
      expect.unreachable("expected a 403");
    } catch (err) {
      expect(err).toBeInstanceOf(HTTPException);
      expect((err as HTTPException).status).toBe(403);
    }
  });

  it("rejects anonymous with 401 (not 403)", () => {
    try {
      requireRole("admin", null);
      expect.unreachable("expected a 401");
    } catch (err) {
      expect((err as HTTPException).status).toBe(401);
    }
  });

  it("enforces admin > moderator > user for admin-only actions", () => {
    const admin = userAt("admin");
    expect(requireRole("admin", admin)).toBe(admin);
    expect(() => requireRole("admin", userAt("moderator"))).toThrow(HTTPException);
    expect(() => requireRole("admin", userAt("user"))).toThrow(HTTPException);
  });
});

describe("requireCurrentUser", () => {
  it("resolves the ambient user when signed in", async () => {
    const user = userAt("user");
    getCurrentUser.mockResolvedValue(user);
    await expect(requireCurrentUser()).resolves.toBe(user);
  });

  it("rejects with 401 when the ambient session is anonymous", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(requireCurrentUser()).rejects.toMatchObject({ status: 401 });
  });
});

describe("requireCurrentRole", () => {
  it("admits a sufficiently-privileged ambient user", async () => {
    const admin = userAt("admin");
    getCurrentUser.mockResolvedValue(admin);
    await expect(requireCurrentRole("moderator")).resolves.toBe(admin);
  });

  it("rejects an under-privileged ambient user with 403", async () => {
    getCurrentUser.mockResolvedValue(userAt("user"));
    await expect(requireCurrentRole("moderator")).rejects.toMatchObject({ status: 403 });
  });

  it("rejects an anonymous ambient session with 401", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(requireCurrentRole("admin")).rejects.toMatchObject({ status: 401 });
  });
});
