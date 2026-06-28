import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `getEnv()` memoizes the first parse of `process.env`. To get deterministic
// control of SESSION_SECRET per test, we reset the module registry before each
// test and dynamically import a fresh copy of the session module (which then
// re-reads env on first use). This keeps tests independent of evaluation order.
const SECRET = "test-session-secret-at-least-32-chars-long-xx";

type SessionModule = typeof import("./session");

async function loadSession(secret: string | undefined): Promise<SessionModule> {
  vi.resetModules();
  process.env.DATABASE_URL = "postgres://user:pass@host/db";
  if (secret === undefined) {
    // Truly remove the key (assigning undefined would stringify to "undefined").
    // biome-ignore lint/performance/noDelete: tests need the var genuinely absent.
    delete process.env.SESSION_SECRET;
  } else {
    process.env.SESSION_SECRET = secret;
  }
  return import("./session");
}

afterEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

describe("session sealing round-trip", () => {
  let session: SessionModule;

  beforeEach(async () => {
    session = await loadSession(SECRET);
  });

  it("seals a user id and reads it back", async () => {
    const sealed = await session.createSessionCookieValue("user-123");
    expect(typeof sealed).toBe("string");
    expect(sealed.length).toBeGreaterThan(0);

    const payload = await session.readSessionCookieValue(sealed);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe("user-123");
    expect(payload?.issuedAt).toBeGreaterThan(0);
  });

  it("returns null for a tampered cookie value", async () => {
    const sealed = await session.createSessionCookieValue("user-123");
    expect(await session.readSessionCookieValue(`${sealed}tamper`)).toBeNull();
  });

  it("returns null for garbage input", async () => {
    expect(await session.readSessionCookieValue("not-a-real-sealed-token")).toBeNull();
    expect(await session.readSessionCookieValue("")).toBeNull();
  });

  it("returns null for an expired session", async () => {
    const staleIssuedAt = Math.floor(Date.now() / 1000) - (session.SESSION_MAX_AGE_SECONDS + 60);
    const sealed = await session.sealSessionPayload({
      userId: "user-123",
      issuedAt: staleIssuedAt,
    });
    expect(await session.readSessionCookieValue(sealed)).toBeNull();
  });

  it("rejects a payload missing required fields", async () => {
    // @ts-expect-error — intentionally invalid payload to test schema rejection.
    const sealed = await session.sealSessionPayload({ issuedAt: Math.floor(Date.now() / 1000) });
    expect(await session.readSessionCookieValue(sealed)).toBeNull();
  });

  it("exposes a stable cookie name", () => {
    expect(session.SESSION_COOKIE_NAME).toBe("al_session");
  });
});

describe("session secret guard", () => {
  it("throws a clear error when SESSION_SECRET is unset", async () => {
    const session = await loadSession(undefined);
    await expect(session.createSessionCookieValue("user-1")).rejects.toThrow(/SESSION_SECRET/);
  });
});
