import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlacesApiKey, parseEnv } from "./env";

// `getEnv()` (which `isProductionEnvironment` calls) memoizes the first parse
// of `process.env` for the lifetime of the module. To get deterministic
// control of `VERCEL_ENV` per test, reset the module registry and dynamically
// import a fresh copy of `./env` for each case (same technique as
// `app/server/auth/session.test.ts`).
type EnvModule = typeof import("./env");

async function loadEnv(vercelEnv: string | undefined): Promise<EnvModule> {
  vi.resetModules();
  process.env.DATABASE_URL = "postgres://user:pass@host/db";
  if (vercelEnv === undefined) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = vercelEnv;
  }
  return import("./env");
}

afterEach(() => {
  delete process.env.VERCEL_ENV;
});

describe("parseEnv", () => {
  it("returns typed env for a valid source", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://user:pass@host/db",
      NODE_ENV: "test",
    });
    expect(env.DATABASE_URL).toBe("postgres://user:pass@host/db");
    expect(env.NODE_ENV).toBe("test");
  });

  it("defaults NODE_ENV to development when omitted", () => {
    const env = parseEnv({ DATABASE_URL: "postgres://user:pass@host/db" });
    expect(env.NODE_ENV).toBe("development");
  });

  it("throws a descriptive error when DATABASE_URL is missing", () => {
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL/);
  });

  it("throws when DATABASE_URL is not a valid URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "not-a-url" })).toThrowError(/DATABASE_URL/);
  });

  it("does not exit the process on invalid input", () => {
    // Regression guard: parseEnv must throw (catchable), never process.exit.
    expect(() => parseEnv({ DATABASE_URL: "" })).toThrow();
  });

  it("parses when the optional human-provisioned secrets are absent", () => {
    const env = parseEnv({ DATABASE_URL: "postgres://user:pass@host/db" });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
    expect(env.GOOGLE_PLACES_API_KEY).toBeUndefined();
    expect(env.SESSION_SECRET).toBeUndefined();
  });

  it("passes through the optional secrets when present", () => {
    // SESSION_SECRET must be >= 32 chars (the string below is exactly 32).
    const env = parseEnv({
      DATABASE_URL: "postgres://user:pass@host/db",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_PLACES_API_KEY: "places-key",
      SESSION_SECRET: "a-32-char-long-session-secret-key",
    });
    expect(env.GOOGLE_CLIENT_ID).toBe("client-id");
    expect(env.GOOGLE_CLIENT_SECRET).toBe("client-secret");
    expect(env.GOOGLE_PLACES_API_KEY).toBe("places-key");
    expect(env.SESSION_SECRET).toBe("a-32-char-long-session-secret-key");
  });

  it("rejects an empty string for an optional secret", () => {
    // Provided-but-empty is a misconfiguration, not an absent var.
    expect(() =>
      parseEnv({
        DATABASE_URL: "postgres://user:pass@host/db",
        SESSION_SECRET: "",
      })
    ).toThrowError(/SESSION_SECRET/);
  });

  it("rejects a SESSION_SECRET shorter than 32 characters", () => {
    // The session signing key protects every cookie; a short value is weak.
    expect("short-secret".length).toBeLessThan(32);
    expect(() =>
      parseEnv({
        DATABASE_URL: "postgres://user:pass@host/db",
        SESSION_SECRET: "short-secret",
      })
    ).toThrowError(/SESSION_SECRET/);
  });

  it("accepts a SESSION_SECRET of at least 32 characters", () => {
    const secret = "a-32-char-long-session-secret-key";
    expect(secret.length).toBeGreaterThanOrEqual(32);
    const env = parseEnv({
      DATABASE_URL: "postgres://user:pass@host/db",
      SESSION_SECRET: secret,
    });
    expect(env.SESSION_SECRET).toBe(secret);
  });

  describe("conditionally-required secrets in production (AUB-150)", () => {
    const fullProdEnv = {
      DATABASE_URL: "postgres://user:pass@host/db",
      VERCEL_ENV: "production",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      SESSION_SECRET: "a-32-char-long-session-secret-key",
    };

    it("passes when VERCEL_ENV=production and all three secrets are present", () => {
      const env = parseEnv(fullProdEnv);
      expect(env.GOOGLE_CLIENT_ID).toBe("client-id");
      expect(env.GOOGLE_CLIENT_SECRET).toBe("client-secret");
      expect(env.SESSION_SECRET).toBe("a-32-char-long-session-secret-key");
    });

    it("fails descriptively when GOOGLE_CLIENT_ID is missing in production", () => {
      const { GOOGLE_CLIENT_ID: _omit, ...rest } = fullProdEnv;
      expect(() => parseEnv(rest)).toThrowError(
        /GOOGLE_CLIENT_ID is required when VERCEL_ENV is production/
      );
    });

    it("fails descriptively when GOOGLE_CLIENT_SECRET is missing in production", () => {
      const { GOOGLE_CLIENT_SECRET: _omit, ...rest } = fullProdEnv;
      expect(() => parseEnv(rest)).toThrowError(
        /GOOGLE_CLIENT_SECRET is required when VERCEL_ENV is production/
      );
    });

    it("fails descriptively when SESSION_SECRET is missing in production", () => {
      const { SESSION_SECRET: _omit, ...rest } = fullProdEnv;
      expect(() => parseEnv(rest)).toThrowError(
        /SESSION_SECRET is required when VERCEL_ENV is production/
      );
    });

    it("reports all three missing secrets at once in production", () => {
      let thrown: unknown;
      try {
        parseEnv({ DATABASE_URL: "postgres://user:pass@host/db", VERCEL_ENV: "production" });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      const message = thrown instanceof Error ? thrown.message : "";
      expect(message).toMatch(/GOOGLE_CLIENT_ID/);
      expect(message).toMatch(/GOOGLE_CLIENT_SECRET/);
      expect(message).toMatch(/SESSION_SECRET/);
    });

    it.each([
      "development",
      "preview",
      undefined,
    ] as const)("passes without the three secrets when VERCEL_ENV=%s", (vercelEnv) => {
      const env = parseEnv({
        DATABASE_URL: "postgres://user:pass@host/db",
        ...(vercelEnv ? { VERCEL_ENV: vercelEnv } : {}),
      });
      expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
      expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
      expect(env.SESSION_SECRET).toBeUndefined();
    });

    it("does not require GOOGLE_PLACES_API_KEY or PREVIEW_LOGIN_SECRET in production (untouched by AUB-150)", () => {
      const env = parseEnv(fullProdEnv);
      expect(env.GOOGLE_PLACES_API_KEY).toBeUndefined();
      expect(env.PREVIEW_LOGIN_SECRET).toBeUndefined();
    });
  });
});

describe("getPlacesApiKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the key without requiring DATABASE_URL (the refresh never opens a DB)", () => {
    // Clearing DATABASE_URL proves this accessor is independent of the full schema.
    vi.stubEnv("DATABASE_URL", undefined);
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "places-key");
    expect(getPlacesApiKey()).toBe("places-key");
  });

  it("throws a descriptive error when the key is missing", () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", undefined);
    expect(() => getPlacesApiKey()).toThrowError(/GOOGLE_PLACES_API_KEY/);
  });

  it("throws when the key is an empty string", () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    expect(() => getPlacesApiKey()).toThrowError(/GOOGLE_PLACES_API_KEY/);
  });
});

describe("isProductionEnvironment (AUB-170)", () => {
  it("is true when VERCEL_ENV=production", async () => {
    const env = await loadEnv("production");
    expect(env.isProductionEnvironment()).toBe(true);
  });

  // Regression guard: a Vercel PREVIEW deployment is still built in
  // `production` mode (`import.meta.env.PROD` would be `true` there), which is
  // exactly the distinction `VERCEL_ENV` — not `import.meta.env.PROD` — must
  // make. Getting this wrong means the root error boundary would wrongly
  // sanitize errors on preview.
  it("is false when VERCEL_ENV=preview (must NOT be treated as production)", async () => {
    const env = await loadEnv("preview");
    expect(env.isProductionEnvironment()).toBe(false);
  });

  it("is false when VERCEL_ENV=development", async () => {
    const env = await loadEnv("development");
    expect(env.isProductionEnvironment()).toBe(false);
  });

  it("is false when VERCEL_ENV is unset (plain local dev/CI)", async () => {
    const env = await loadEnv(undefined);
    expect(env.isProductionEnvironment()).toBe(false);
  });

  it("fails closed to true if the environment can't be read/validated", async () => {
    vi.resetModules();
    // No DATABASE_URL — `getEnv()` throws on first access.
    delete process.env.DATABASE_URL;
    const env = await import("./env");
    expect(env.isProductionEnvironment()).toBe(true);
    process.env.DATABASE_URL = "postgres://user:pass@host/db";
  });
});
