import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Env must be present before `getEnv()` (called lazily by google.ts) runs.
beforeAll(() => {
  process.env.DATABASE_URL = "postgres://user:pass@host/db";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
});

const { fetchGoogleUserInfo, isEmailVerified } = await import("./google");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isEmailVerified", () => {
  it("treats boolean true as verified", () => {
    expect(isEmailVerified(true)).toBe(true);
  });

  it('treats the string "true" as verified', () => {
    expect(isEmailVerified("true")).toBe(true);
  });

  it("treats boolean false as unverified", () => {
    expect(isEmailVerified(false)).toBe(false);
  });

  it('treats the string "false" as unverified', () => {
    expect(isEmailVerified("false")).toBe(false);
  });

  it("treats absent (undefined) as unverified (fail closed)", () => {
    expect(isEmailVerified(undefined)).toBe(false);
  });

  it("treats an unrecognized string as unverified (fail closed)", () => {
    expect(isEmailVerified("maybe")).toBe(false);
  });
});

describe("fetchGoogleUserInfo (AUB-183: email_verified enforcement)", () => {
  function mockUserinfoResponse(body: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      )
    );
  }

  const baseProfile = {
    sub: "google-sub-1",
    email: "person@example.com",
    name: "Person Example",
  };

  it("returns the profile when email_verified is boolean true", async () => {
    mockUserinfoResponse({ ...baseProfile, email_verified: true });
    const profile = await fetchGoogleUserInfo("token");
    expect(profile.email).toBe("person@example.com");
  });

  it('returns the profile when email_verified is the string "true"', async () => {
    mockUserinfoResponse({ ...baseProfile, email_verified: "true" });
    const profile = await fetchGoogleUserInfo("token");
    expect(profile.sub).toBe("google-sub-1");
  });

  it("rejects sign-in when email_verified is boolean false", async () => {
    mockUserinfoResponse({ ...baseProfile, email_verified: false });
    await expect(fetchGoogleUserInfo("token")).rejects.toThrowError(/not verified/);
  });

  it('rejects sign-in when email_verified is the string "false"', async () => {
    mockUserinfoResponse({ ...baseProfile, email_verified: "false" });
    await expect(fetchGoogleUserInfo("token")).rejects.toThrowError(/not verified/);
  });

  it("rejects sign-in when email_verified is absent", async () => {
    mockUserinfoResponse({ ...baseProfile });
    await expect(fetchGoogleUserInfo("token")).rejects.toThrowError(/not verified/);
  });
});
