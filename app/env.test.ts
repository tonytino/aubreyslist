import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

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
    const env = parseEnv({
      DATABASE_URL: "postgres://user:pass@host/db",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_PLACES_API_KEY: "places-key",
      SESSION_SECRET: "a-long-random-session-secret",
    });
    expect(env.GOOGLE_CLIENT_ID).toBe("client-id");
    expect(env.GOOGLE_CLIENT_SECRET).toBe("client-secret");
    expect(env.GOOGLE_PLACES_API_KEY).toBe("places-key");
    expect(env.SESSION_SECRET).toBe("a-long-random-session-secret");
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
});
