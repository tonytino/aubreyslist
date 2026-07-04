import { describe, expect, it } from "vitest";
import app from "./index";

describe("api app", () => {
  it("serves the health check", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const res = await app.request("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "Not Found" });
  });
});

describe("security response headers (AUB-162)", () => {
  it("stamps the security header set on an /api response", async () => {
    const res = await app.request("/api/health");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("stamps headers even on a 404 response", async () => {
    const res = await app.request("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });
});

describe("origin check on /api mutations (AUB-174)", () => {
  it("allows a same-origin POST through to the handler", async () => {
    const res = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: { origin: "http://localhost" },
    });
    // sign-out clears the cookie and redirects home — proof the guard passed.
    expect(res.status).toBe(302);
  });

  it("rejects a cross-origin POST with 403 before the handler runs", async () => {
    const res = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    // The rejection is not the handler's redirect.
    expect(res.headers.get("location")).toBeNull();
  });

  it("rejects a POST that carries neither Origin nor Referer (policy)", async () => {
    const res = await app.request("/api/auth/sign-out", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("still carries the security headers on a 403 rejection", async () => {
    const res = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });
});
