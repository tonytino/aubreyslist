import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The async wrapper resolves the ambient session through getCurrentUser; mock it
// so we exercise the limiter logic, not cookie/DB plumbing (covered elsewhere).
const getCurrentUser = vi.fn();
vi.mock("../auth/current-user", () => ({ getCurrentUser: () => getCurrentUser() }));

const { InMemoryRateLimiter, enforceRateLimit, enforceWriteLimit, DEFAULT_WRITE_RATE_LIMIT } =
  await import("./index");

/** A controllable clock so window resets are deterministic (no real sleeps). */
function fakeClock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("InMemoryRateLimiter.hit", () => {
  it("allows hits up to the limit", () => {
    const limiter = new InMemoryRateLimiter({ limit: 3, windowMs: 1000 }, () => 0);
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(true);
  });

  it("rejects the hit that exceeds the limit", () => {
    const limiter = new InMemoryRateLimiter({ limit: 2, windowMs: 1000 }, () => 0);
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(false);
  });

  it("does not consume the counter on a rejected hit (back-off is not penalised)", () => {
    const clock = fakeClock();
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 1000 }, clock.now);
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(false);
    expect(limiter.hit("u1")).toBe(false);
    // Window elapses; the first hit in the new window is allowed.
    clock.advance(1000);
    expect(limiter.hit("u1")).toBe(true);
  });

  it("resets the count once the fixed window elapses", () => {
    const clock = fakeClock();
    const limiter = new InMemoryRateLimiter({ limit: 2, windowMs: 1000 }, clock.now);
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(false);

    clock.advance(999); // still inside the window
    expect(limiter.hit("u1")).toBe(false);

    clock.advance(1); // window boundary reached -> fresh window
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(false);
  });

  it("isolates counters per key (one user's burst never affects another)", () => {
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 1000 }, () => 0);
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(false);
    // u2 has its own window.
    expect(limiter.hit("u2")).toBe(true);
  });
});

describe("InMemoryRateLimiter.enforce", () => {
  it("returns silently while under the limit", () => {
    const limiter = new InMemoryRateLimiter({ limit: 2, windowMs: 1000 }, () => 0);
    expect(() => limiter.enforce("u1")).not.toThrow();
    expect(() => limiter.enforce("u1")).not.toThrow();
  });

  it("throws HTTPException(429) once the limit is exceeded", () => {
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 1000 }, () => 0);
    limiter.enforce("u1");
    try {
      limiter.enforce("u1");
      expect.unreachable("expected a 429");
    } catch (err) {
      expect(err).toBeInstanceOf(HTTPException);
      expect((err as HTTPException).status).toBe(429);
    }
  });

  it("carries a non-empty message (the 429 body the caller sees)", () => {
    // `app.onError` returns the HTTPException verbatim, and its response body IS
    // this message — an empty/missing one would ship a blank 429 to the user.
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 1000 }, () => 0);
    limiter.enforce("u1");
    try {
      limiter.enforce("u1");
      expect.unreachable("expected a 429");
    } catch (err) {
      // Assert non-emptiness, not the wording: the phrasing is user-facing copy
      // (docs/agents/copy.md) and a rewrite must not red-line this unit test.
      expect((err as HTTPException).message.trim()).not.toBe("");
    }
  });

  it("allows again after the window resets", () => {
    const clock = fakeClock();
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 1000 }, clock.now);
    limiter.enforce("u1");
    expect(() => limiter.enforce("u1")).toThrow(HTTPException);
    clock.advance(1000);
    expect(() => limiter.enforce("u1")).not.toThrow();
  });
});

describe("InMemoryRateLimiter.reset / clear", () => {
  it("reset drops a single key's window", () => {
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 1000 }, () => 0);
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(false);
    limiter.reset("u1");
    expect(limiter.hit("u1")).toBe(true);
  });

  it("clear drops every key's window", () => {
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 1000 }, () => 0);
    limiter.hit("u1");
    limiter.hit("u2");
    limiter.clear();
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u2")).toBe(true);
  });
});

describe("default config", () => {
  it("caps bursts at 50 writes per 60s window", () => {
    expect(DEFAULT_WRITE_RATE_LIMIT).toEqual({ limit: 50, windowMs: 60_000 });
  });
});

describe("enforceRateLimit (production singleton)", () => {
  // The exported helpers share one process-wide limiter; key each test on a
  // unique id so the shared map can't leak state across tests.
  it("allows the first writes for a fresh key, then 429s past the default cap", () => {
    const key = `prod-${Math.random()}`;
    for (let i = 0; i < DEFAULT_WRITE_RATE_LIMIT.limit; i++) {
      expect(() => enforceRateLimit(key)).not.toThrow();
    }
    expect(() => enforceRateLimit(key)).toThrow(HTTPException);
  });

  it("isolates the singleton per user", () => {
    const a = `prod-a-${Math.random()}`;
    const b = `prod-b-${Math.random()}`;
    for (let i = 0; i < DEFAULT_WRITE_RATE_LIMIT.limit; i++) {
      enforceRateLimit(a);
    }
    expect(() => enforceRateLimit(a)).toThrow(HTTPException);
    // b is untouched.
    expect(() => enforceRateLimit(b)).not.toThrow();
  });
});

describe("enforceWriteLimit (server-fn convenience)", () => {
  beforeEach(() => {
    getCurrentUser.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses an explicit userId without touching the session", async () => {
    const key = `explicit-${Math.random()}`;
    await expect(enforceWriteLimit(key)).resolves.toBeUndefined();
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("falls back to the ambient user id when no key is passed", async () => {
    const id = `ambient-${Math.random()}`;
    getCurrentUser.mockResolvedValue({ id });
    await expect(enforceWriteLimit()).resolves.toBeUndefined();
    expect(getCurrentUser).toHaveBeenCalledOnce();
  });

  it("is a no-op when no user can be resolved (auth guard owns anonymous rejection)", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(enforceWriteLimit()).resolves.toBeUndefined();
  });

  it("actually enforces the cap for the ambient user (not just a pass-through)", async () => {
    const id = `ambient-cap-${Math.random()}`;
    getCurrentUser.mockResolvedValue({ id });
    for (let i = 0; i < DEFAULT_WRITE_RATE_LIMIT.limit; i++) {
      await expect(enforceWriteLimit()).resolves.toBeUndefined();
    }
    await expect(enforceWriteLimit()).rejects.toThrow(HTTPException);
  });

  it("never meters an anonymous caller, even over a sustained burst", async () => {
    // Anonymous writes are rejected by the auth guard (401), never by this
    // limiter. If the missing key fell through, every anonymous caller in the
    // process would share one bucket and start 429ing each other — the wrong
    // status, from the wrong layer, for a request the auth guard should own.
    getCurrentUser.mockResolvedValue(null);
    for (let i = 0; i < DEFAULT_WRITE_RATE_LIMIT.limit + 5; i++) {
      await expect(enforceWriteLimit()).resolves.toBeUndefined();
    }
  });
});
