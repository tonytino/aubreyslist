// @vitest-environment node
// Server-only module — run in Node (like production), not jsdom. Under jsdom,
// `crypto.subtle` results come from a different JS realm, tripping the strict
// `instanceof Uint8Array` checks inside iron-webcrypto v2's base64 encoding.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Env must be present before the modules that read it are imported.
beforeAll(() => {
  process.env.DATABASE_URL = "postgres://user:pass@host/db";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars-long-xx";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
});

// Mock the DB-backed user upsert so the callback never touches a real database.
const upsertUserFromGoogle = vi.fn();
vi.mock("../auth/users", () => ({
  upsertUserFromGoogle: (...args: unknown[]) => upsertUserFromGoogle(...args),
}));

const { authRoutes, validateReturnTo } = await import("./auth");
const { SESSION_COOKIE_NAME, readSessionCookieValue } = await import("../auth/session");

/** Parse `Set-Cookie` headers into a name→value map. */
function parseSetCookies(res: Response): Map<string, string> {
  const map = new Map<string, string>();
  for (const header of res.headers.getSetCookie()) {
    const pair = header.split(";")[0] ?? "";
    const idx = pair.indexOf("=");
    map.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
  return map;
}

beforeEach(() => {
  upsertUserFromGoogle.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validateReturnTo (open-redirect defense)", () => {
  const origin = "http://localhost";

  it("accepts a plain same-origin path", () => {
    expect(validateReturnTo("/favorites", origin)).toBe("/favorites");
  });

  it("accepts a path with a query string (so ?save=<id> survives)", () => {
    expect(validateReturnTo("/listings/x?save=y", origin)).toBe("/listings/x?save=y");
  });

  it("defaults to / when returnTo is undefined", () => {
    expect(validateReturnTo(undefined, origin)).toBe("/");
  });

  it.each([
    ["protocol-relative `//host`", "//evil.com"],
    ["absolute https URL", "https://evil"],
    ["absolute http URL", "http://evil.com/path"],
    ["backslash smuggling `/\\`", "/\\evil"],
    ["percent-encoded `//`", "%2f%2fevil"],
    ["upper-case percent-encoded `//`", "/%2F%2Fevil"],
    ["percent-encoded backslash `%5c`", "/%5cevil"],
    ["CRLF header injection", "/foo\r\nSet-Cookie: x"],
    ["tab control char", "/foo\tbar"],
    ["does not start with a slash", "favorites"],
    ["empty string", ""],
    ["malformed percent-encoding", "/%zz"],
    ["a bare `//`", "//"],
  ])("rejects %s → /", (_label, input) => {
    expect(validateReturnTo(input, origin)).toBe("/");
  });

  it("rejects a same-path that resolves to a different origin", () => {
    // Backslash-based host confusion is neutralised by the `/\` guard.
    expect(validateReturnTo("/\\/evil.com", origin)).toBe("/");
  });
});

describe("GET /google (sign-in initiation)", () => {
  it("redirects to Google with state + PKCE and sets transaction cookies", async () => {
    const res = await authRoutes.request("http://localhost/google");
    expect(res.status).toBe(302);

    const location = res.headers.get("location");
    expect(location).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    const authUrl = new URL(location ?? "");
    expect(authUrl.searchParams.get("client_id")).toBe("test-client-id");
    expect(authUrl.searchParams.get("response_type")).toBe("code");
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("scope")).toContain("openid");
    expect(authUrl.searchParams.get("state")).toBeTruthy();
    expect(authUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost/api/auth/callback/google"
    );

    const cookies = parseSetCookies(res);
    expect(cookies.get("al_oauth_state")).toBeTruthy();
    expect(cookies.get("al_oauth_verifier")).toBeTruthy();
    // The state in the cookie must match the state in the redirect URL.
    expect(cookies.get("al_oauth_state")).toBe(authUrl.searchParams.get("state"));
  });

  it("stashes a valid same-origin returnTo in a tx cookie (not in OAuth state)", async () => {
    const res = await authRoutes.request(
      "http://localhost/google?returnTo=%2Flistings%2Fx%3Fsave%3Dy"
    );
    expect(res.status).toBe(302);

    const cookies = parseSetCookies(res);
    // The cookie is URL-encoded by Set-Cookie; decode before comparing.
    expect(decodeURIComponent(cookies.get("al_oauth_return_to") ?? "")).toBe("/listings/x?save=y");

    // returnTo must NEVER be round-tripped through Google's OAuth state param.
    const authUrl = new URL(res.headers.get("location") ?? "");
    expect(authUrl.searchParams.get("state")).not.toContain("listings");
  });

  it("does not set a returnTo cookie for an open-redirect attempt", async () => {
    const res = await authRoutes.request("http://localhost/google?returnTo=%2F%2Fevil.com");
    expect(res.status).toBe(302);
    const cookies = parseSetCookies(res);
    expect(cookies.get("al_oauth_return_to")).toBeUndefined();
  });
});

describe("GET /callback/google (OAuth callback)", () => {
  it("exchanges the code, upserts the user, and sets a verified session", async () => {
    upsertUserFromGoogle.mockResolvedValue({
      id: "user-abc",
      googleSub: "google-sub-1",
      email: "person@example.com",
      name: "Person Example",
      avatarUrl: null,
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Mock Google's token + userinfo endpoints — never hit the network.
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "ya29.fake-access-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
        return new Response(
          JSON.stringify({
            sub: "google-sub-1",
            email: "person@example.com",
            email_verified: true,
            name: "Person Example",
            picture: "https://example.com/avatar.png",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await authRoutes.request(
      "http://localhost/callback/google?code=auth-code&state=xyz",
      {
        headers: { cookie: "al_oauth_state=xyz; al_oauth_verifier=verifier-123" },
      }
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/");

    // The token exchange must include the PKCE verifier and our client secret.
    const tokenCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/token"));
    expect(tokenCall).toBeDefined();
    const tokenBody = (tokenCall?.[1]?.body as URLSearchParams).toString();
    expect(tokenBody).toContain("code=auth-code");
    expect(tokenBody).toContain("code_verifier=verifier-123");
    expect(tokenBody).toContain("client_secret=test-client-secret");

    // The user was upserted by google_sub.
    expect(upsertUserFromGoogle).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "google-sub-1", email: "person@example.com" })
    );

    // A valid, verifiable session cookie was set for the upserted user id.
    const cookies = parseSetCookies(res);
    const sessionCookie = cookies.get(SESSION_COOKIE_NAME);
    expect(sessionCookie).toBeTruthy();
    const payload = await readSessionCookieValue(decodeURIComponent(sessionCookie ?? ""));
    expect(payload?.userId).toBe("user-abc");
  });

  it("redirects to a stashed returnTo and clears the tx cookie", async () => {
    upsertUserFromGoogle.mockResolvedValue({
      id: "user-abc",
      googleSub: "google-sub-1",
      email: "person@example.com",
      name: "Person Example",
      avatarUrl: null,
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "ya29.fake-access-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
        return new Response(
          JSON.stringify({
            sub: "google-sub-1",
            email: "person@example.com",
            email_verified: true,
            name: "Person Example",
            picture: "https://example.com/avatar.png",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await authRoutes.request(
      "http://localhost/callback/google?code=auth-code&state=xyz",
      {
        headers: {
          cookie:
            "al_oauth_state=xyz; al_oauth_verifier=verifier-123; al_oauth_return_to=%2Ffavorites",
        },
      }
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/favorites");

    // The single-use returnTo cookie is cleared on the callback.
    const cleared = res.headers
      .getSetCookie()
      .some((h) => h.startsWith("al_oauth_return_to=") && h.includes("Max-Age=0"));
    expect(cleared).toBe(true);
  });

  it("rejects when the state does not match (CSRF guard)", async () => {
    const res = await authRoutes.request(
      "http://localhost/callback/google?code=auth-code&state=evil",
      { headers: { cookie: "al_oauth_state=xyz; al_oauth_verifier=verifier-123" } }
    );
    expect(res.status).toBe(400);
    expect(upsertUserFromGoogle).not.toHaveBeenCalled();
  });

  it("rejects when the state cookie is missing", async () => {
    const res = await authRoutes.request(
      "http://localhost/callback/google?code=auth-code&state=xyz"
    );
    expect(res.status).toBe(400);
    expect(upsertUserFromGoogle).not.toHaveBeenCalled();
  });

  it("rejects when Google returns an error param", async () => {
    const res = await authRoutes.request("http://localhost/callback/google?error=access_denied");
    expect(res.status).toBe(400);
    expect(upsertUserFromGoogle).not.toHaveBeenCalled();
  });

  it("rejects sign-in without upserting when Google reports email_verified: false (AUB-183)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "ya29.fake-access-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
        return new Response(
          JSON.stringify({
            sub: "google-sub-unverified",
            email: "unverified@example.com",
            email_verified: false,
            name: "Unverified Person",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await authRoutes.request(
      "http://localhost/callback/google?code=auth-code&state=xyz",
      {
        headers: { cookie: "al_oauth_state=xyz; al_oauth_verifier=verifier-123" },
      }
    );

    // The email-verification failure surfaces through the same generic-500
    // path as other Google-side failures in this handler (malformed
    // responses, failed token exchange) — see app/server/auth/google.ts.
    expect(res.status).toBe(500);
    expect(upsertUserFromGoogle).not.toHaveBeenCalled();
  });

  it('rejects sign-in without upserting when Google reports email_verified as the string "false" (AUB-183)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "ya29.fake-access-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
        return new Response(
          JSON.stringify({
            sub: "google-sub-unverified-str",
            email: "unverified-str@example.com",
            email_verified: "false",
            name: "Unverified Person",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await authRoutes.request(
      "http://localhost/callback/google?code=auth-code&state=xyz",
      {
        headers: { cookie: "al_oauth_state=xyz; al_oauth_verifier=verifier-123" },
      }
    );

    expect(res.status).toBe(500);
    expect(upsertUserFromGoogle).not.toHaveBeenCalled();
  });

  it('accepts sign-in when Google reports email_verified as the string "true" (AUB-183)', async () => {
    upsertUserFromGoogle.mockResolvedValue({
      id: "user-str-true",
      googleSub: "google-sub-str-true",
      email: "str-true@example.com",
      name: "String True Person",
      avatarUrl: null,
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "ya29.fake-access-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
        return new Response(
          JSON.stringify({
            sub: "google-sub-str-true",
            email: "str-true@example.com",
            email_verified: "true",
            name: "String True Person",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await authRoutes.request(
      "http://localhost/callback/google?code=auth-code&state=xyz",
      {
        headers: { cookie: "al_oauth_state=xyz; al_oauth_verifier=verifier-123" },
      }
    );

    expect(res.status).toBe(302);
    expect(upsertUserFromGoogle).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "google-sub-str-true", email: "str-true@example.com" })
    );
  });
});

describe("POST /sign-out", () => {
  it("clears the session cookie and redirects home", async () => {
    const res = await authRoutes.request("http://localhost/sign-out", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/");

    // Deleting a cookie sets it with an empty value / past expiry.
    const cleared = res.headers
      .getSetCookie()
      .some((h) => h.startsWith(`${SESSION_COOKIE_NAME}=`) && h.includes("Max-Age=0"));
    expect(cleared).toBe(true);
  });
});
