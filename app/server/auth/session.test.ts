// @vitest-environment node
// Server-only module — run in Node (like production), not jsdom. Under jsdom,
// `crypto.subtle` results come from a different JS realm, tripping the strict
// `instanceof Uint8Array` checks inside iron-webcrypto v2's base64 encoding.
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

  it("still unseals a cookie minted by iron-webcrypto 1.x (pre-2.0 seal format)", async () => {
    // Fixture sealed by iron-webcrypto@1.2.1 with SECRET and the library
    // defaults — the exact bytes a live session cookie issued before the
    // 1.x → 2.x upgrade would carry. If the 2.x unseal path (or our options)
    // ever breaks the Fe26.2 wire format, this fails and flags that shipping
    // would log every existing user out. Regenerate (if ever needed) by
    // sealing { userId: "user-legacy-1x", issuedAt: 1751500800 } with 1.x.
    const sealedByV1 =
      "Fe26.2**781f55721b40a1cad12803eb539c9e473f3ac426a0d0eb5c8d5b81561c7b7958*pcm74qNpCAQ7NtJh2kiLPw*YzayLwoZc8BANcOXACujIgbuJWm0YU9GVuJ0qXq7-Qxl7uaO_qWgxFjvAvmyThPccvT_-GUjqap8R1uVnGb5cg**4d7e957b9241a1fd7d590449e2747c544001ce8b5af43ed7d0ab7ebc5b04a793*wrMlSFnLmTo_spybRJVowbBfEim8KG4iwcLQMWTPGS4";

    // Pin the clock just after the fixture's issuedAt (2025-07-03T00:00:00Z)
    // so the app-level 30-day expiry check never rots this test.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-07-04T00:00:00Z"));
    try {
      const payload = await session.readSessionCookieValue(sealedByV1);
      expect(payload).toEqual({ userId: "user-legacy-1x", issuedAt: 1751500800 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("session secret guard", () => {
  it("throws a clear error when SESSION_SECRET is unset", async () => {
    const session = await loadSession(undefined);
    await expect(session.createSessionCookieValue("user-1")).rejects.toThrow(/SESSION_SECRET/);
  });
});
