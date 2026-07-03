import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit + HTTP-route coverage for the preview-only dev-login (AUB-138).
 *
 * We mock `~/env` with a MUTABLE env object (rather than `process.env` +
 * memoized `getEnv`) so each test can flip `VERCEL_ENV` / `PREVIEW_LOGIN_SECRET`
 * deterministically — `getEnv()` reads the live object on every call. `~/db/client`
 * is mocked so `resolvePreviewUser`'s upsert never touches a real database. The
 * session module reads the same mocked env, so the real seal/unseal round-trips.
 */

const SESSION_SECRET = "test-session-secret-at-least-32-chars-long-xx";
const PREVIEW_SECRET = "preview-login-secret-at-least-32-chars-longg";

interface MockEnv {
  DATABASE_URL: string;
  NODE_ENV: "development" | "production" | "test";
  SESSION_SECRET: string | undefined;
  VERCEL_ENV: "production" | "preview" | "development" | undefined;
  PREVIEW_LOGIN_SECRET: string | undefined;
}

const env: MockEnv = {
  DATABASE_URL: "postgres://user:pass@host/db",
  NODE_ENV: "test",
  SESSION_SECRET,
  VERCEL_ENV: "preview",
  PREVIEW_LOGIN_SECRET: PREVIEW_SECRET,
};

vi.mock("~/env", () => ({ getEnv: () => env }));

// Mock the DB client so the preview-user upsert (find → insert) is what we
// verify, not Drizzle/Neon itself.
const findFirst = vi.fn();
const returningInsert = vi.fn();
const insertValues = vi.fn((_values: Record<string, unknown>) => ({ returning: returningInsert }));
const db = {
  query: { users: { findFirst } },
  insert: vi.fn(() => ({ values: insertValues })),
};
vi.mock("~/db/client", () => ({ getDb: () => db }));

const { isPreviewLoginEnabled, verifyPreviewSecret, resolvePreviewUser, renderDevLoginPage } =
  await import("./preview-login");
const { SESSION_COOKIE_NAME, readSessionCookieValue } = await import("./session");
const { authRoutes } = await import("../routes/auth");

/** Reset env to a "preview + secret provisioned" (enabled) baseline. */
function resetEnv(): void {
  env.NODE_ENV = "test";
  env.SESSION_SECRET = SESSION_SECRET;
  env.VERCEL_ENV = "preview";
  env.PREVIEW_LOGIN_SECRET = PREVIEW_SECRET;
}

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
  resetEnv();
  findFirst.mockReset();
  returningInsert.mockReset();
  insertValues.mockClear();
  db.insert.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isPreviewLoginEnabled", () => {
  it("is false in Vercel production even when the secret is set", () => {
    env.VERCEL_ENV = "production";
    env.PREVIEW_LOGIN_SECRET = PREVIEW_SECRET;
    expect(isPreviewLoginEnabled()).toBe(false);
  });

  it("is false when the secret is unset (even on a preview deployment)", () => {
    env.VERCEL_ENV = "preview";
    env.PREVIEW_LOGIN_SECRET = undefined;
    expect(isPreviewLoginEnabled()).toBe(false);
  });

  it("is true on a preview deployment with the secret set", () => {
    env.VERCEL_ENV = "preview";
    env.PREVIEW_LOGIN_SECRET = PREVIEW_SECRET;
    expect(isPreviewLoginEnabled()).toBe(true);
  });

  it("is true for VERCEL_ENV=development with the secret set (local dev-login)", () => {
    env.VERCEL_ENV = "development";
    env.PREVIEW_LOGIN_SECRET = PREVIEW_SECRET;
    expect(isPreviewLoginEnabled()).toBe(true);
  });

  it("is false when VERCEL_ENV is unset — fail-closed (secret set)", () => {
    env.VERCEL_ENV = undefined;
    env.PREVIEW_LOGIN_SECRET = PREVIEW_SECRET;
    expect(isPreviewLoginEnabled()).toBe(false);
  });
});

describe("verifyPreviewSecret", () => {
  it("is true only on an exact match", () => {
    expect(verifyPreviewSecret(PREVIEW_SECRET)).toBe(true);
  });

  it("is false on a mismatch (same length)", () => {
    const wrong = `${PREVIEW_SECRET.slice(0, -1)}X`;
    expect(wrong.length).toBe(PREVIEW_SECRET.length);
    expect(verifyPreviewSecret(wrong)).toBe(false);
  });

  it("is false on a mismatch (different length)", () => {
    expect(verifyPreviewSecret(`${PREVIEW_SECRET}extra`)).toBe(false);
  });

  it("is false when the candidate is missing", () => {
    expect(verifyPreviewSecret(undefined)).toBe(false);
  });

  it("is false when the endpoint is disabled (Vercel production)", () => {
    env.VERCEL_ENV = "production";
    expect(verifyPreviewSecret(PREVIEW_SECRET)).toBe(false);
  });

  it("is false when the endpoint is disabled (secret unset)", () => {
    env.PREVIEW_LOGIN_SECRET = undefined;
    expect(verifyPreviewSecret(PREVIEW_SECRET)).toBe(false);
  });
});

describe("resolvePreviewUser", () => {
  it("inserts the default preview tester (synthetic google_sub) when absent", async () => {
    findFirst.mockResolvedValue(undefined);
    returningInsert.mockResolvedValue([{ id: "preview-user-1", role: "user" }]);

    const user = await resolvePreviewUser();

    expect(user.id).toBe("preview-user-1");
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    const values = insertValues.mock.calls[0]?.[0];
    expect(values).toMatchObject({
      googleSub: "preview:preview-tester@aubreyslist.test",
      email: "preview-tester@aubreyslist.test",
      name: "Preview Tester",
    });
    // Role must never be set here → DB default `user` (ADR-010).
    expect(values).not.toHaveProperty("role");
  });

  it("returns the existing preview row without inserting (idempotent)", async () => {
    findFirst.mockResolvedValue({
      id: "existing-preview",
      googleSub: "preview:preview-tester@aubreyslist.test",
      role: "user",
    });

    const user = await resolvePreviewUser();

    expect(user.id).toBe("existing-preview");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("REFUSES a non-preview (real OAuth) account with 403 — no insert", async () => {
    // A real admin row (google_sub is a genuine Google subject, not `preview:`).
    findFirst.mockResolvedValue({
      id: "real-admin",
      googleSub: "108461234567890",
      email: "admin@real.example",
      role: "admin",
    });

    await expect(resolvePreviewUser("admin@real.example")).rejects.toMatchObject({
      status: 403,
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("honors a custom email override", async () => {
    findFirst.mockResolvedValue(undefined);
    returningInsert.mockResolvedValue([{ id: "custom", role: "user" }]);

    await resolvePreviewUser("someone@example.com");

    expect(insertValues.mock.calls[0]?.[0]).toMatchObject({
      googleSub: "preview:someone@example.com",
      email: "someone@example.com",
    });
  });
});

describe("GET /dev-login (route)", () => {
  it("returns 404 when disabled (no Set-Cookie)", async () => {
    env.VERCEL_ENV = "production"; // disabled even though a secret is present.
    const res = await authRoutes.request(
      `http://localhost/dev-login?secret=${encodeURIComponent(PREVIEW_SECRET)}`
    );
    expect(res.status).toBe(404);
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("returns 401 with a wrong secret (no Set-Cookie)", async () => {
    const res = await authRoutes.request("http://localhost/dev-login?secret=nope");
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("serves the HTML sign-in form (no secret) instead of signing in", async () => {
    const res = await authRoutes.request("http://localhost/dev-login");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('<form method="post" action="/api/auth/dev-login">');
    expect(html).toContain('name="secret"');
    // The form does NOT sign anyone in — no session cookie, no DB write.
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("404s the form (not the login) when disabled — invisible in production", async () => {
    env.VERCEL_ENV = "production";
    const res = await authRoutes.request("http://localhost/dev-login");
    expect(res.status).toBe(404);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("mints a verifiable session and redirects to / by default", async () => {
    findFirst.mockResolvedValue(undefined);
    returningInsert.mockResolvedValue([{ id: "minted-user", role: "user" }]);

    const res = await authRoutes.request(
      `http://localhost/dev-login?secret=${encodeURIComponent(PREVIEW_SECRET)}`
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/");

    const cookies = parseSetCookies(res);
    const sessionCookie = cookies.get(SESSION_COOKIE_NAME);
    expect(sessionCookie).toBeTruthy();
    const payload = await readSessionCookieValue(decodeURIComponent(sessionCookie ?? ""));
    expect(payload?.userId).toBe("minted-user");
  });

  it("returns 403 when the email resolves to a real (non-preview) account — no cookie/insert", async () => {
    // Preview DBs are Neon branches of prod, so a real admin row can exist.
    findFirst.mockResolvedValue({
      id: "real-admin",
      googleSub: "108461234567890",
      email: "admin@real.example",
      role: "admin",
    });

    const res = await authRoutes.request(
      `http://localhost/dev-login?secret=${encodeURIComponent(PREVIEW_SECRET)}&email=admin%40real.example`
    );

    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("accepts the secret via the x-preview-login-secret header", async () => {
    findFirst.mockResolvedValue({
      id: "header-user",
      googleSub: "preview:preview-tester@aubreyslist.test",
      role: "user",
    });

    const res = await authRoutes.request("http://localhost/dev-login", {
      headers: { "x-preview-login-secret": PREVIEW_SECRET },
    });

    expect(res.status).toBe(302);
    const cookies = parseSetCookies(res);
    expect(cookies.get(SESSION_COOKIE_NAME)).toBeTruthy();
  });

  it("rejects an open-redirect returnTo back to /", async () => {
    findFirst.mockResolvedValue({
      id: "u",
      googleSub: "preview:preview-tester@aubreyslist.test",
      role: "user",
    });

    const res = await authRoutes.request(
      `http://localhost/dev-login?secret=${encodeURIComponent(PREVIEW_SECRET)}&returnTo=%2F%2Fevil.com`
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/");
  });

  it("honors a valid same-origin returnTo", async () => {
    findFirst.mockResolvedValue({
      id: "u",
      googleSub: "preview:preview-tester@aubreyslist.test",
      role: "user",
    });

    const res = await authRoutes.request(
      `http://localhost/dev-login?secret=${encodeURIComponent(PREVIEW_SECRET)}&returnTo=%2Ffavorites`
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/favorites");
  });
});

describe("POST /dev-login (form submit)", () => {
  /** Build a form-encoded POST request to the dev-login route. */
  function formPost(fields: Record<string, string>): Request {
    return new Request("http://localhost/dev-login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
  }

  it("404s when disabled — no cookie, no DB write", async () => {
    env.VERCEL_ENV = "production";
    const res = await authRoutes.request(formPost({ secret: PREVIEW_SECRET }));
    expect(res.status).toBe(404);
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("re-renders the form with a 401 + inline error on a wrong secret (no cookie)", async () => {
    const res = await authRoutes.request(formPost({ secret: "nope" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('role="alert"');
    expect(html).toContain('<form method="post"');
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("mints a verifiable session from the body secret and redirects", async () => {
    findFirst.mockResolvedValue({
      id: "posted-user",
      googleSub: "preview:preview-tester@aubreyslist.test",
      role: "user",
    });

    const res = await authRoutes.request(
      formPost({ secret: PREVIEW_SECRET, returnTo: "/favorites" })
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/favorites");
    const cookies = parseSetCookies(res);
    const sessionCookie = cookies.get(SESSION_COOKIE_NAME);
    expect(sessionCookie).toBeTruthy();
    const payload = await readSessionCookieValue(decodeURIComponent(sessionCookie ?? ""));
    expect(payload?.userId).toBe("posted-user");
  });

  it("rejects an open-redirect returnTo from the body back to /", async () => {
    findFirst.mockResolvedValue({
      id: "u",
      googleSub: "preview:preview-tester@aubreyslist.test",
      role: "user",
    });

    const res = await authRoutes.request(
      formPost({ secret: PREVIEW_SECRET, returnTo: "//evil.com" })
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/");
  });
});

describe("renderDevLoginPage", () => {
  it("renders a POST form with a password secret field and no prefilled secret", () => {
    const html = renderDevLoginPage({ returnTo: "/" });
    expect(html).toContain('<form method="post" action="/api/auth/dev-login">');
    expect(html).toContain('name="secret"');
    expect(html).toContain('type="password"');
    // The secret is NEVER echoed into the page.
    expect(html).not.toContain(PREVIEW_SECRET);
  });

  it("is noindex so preview URLs stay out of search engines", () => {
    expect(renderDevLoginPage({ returnTo: "/" })).toContain('name="robots"');
  });

  it("HTML-escapes the reflected returnTo and email (no attribute breakout)", () => {
    const html = renderDevLoginPage({
      returnTo: '/"><script>alert(1)</script>',
      email: '"><img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows the inline error banner only when an error is given", () => {
    expect(renderDevLoginPage({ returnTo: "/" })).not.toContain('role="alert"');
    expect(renderDevLoginPage({ returnTo: "/", error: "Nope" })).toContain('role="alert"');
    expect(renderDevLoginPage({ returnTo: "/", error: "Nope" })).toContain("Nope");
  });
});
