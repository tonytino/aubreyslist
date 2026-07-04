import { describe, expect, it } from "vitest";
import {
  checkSameOrigin,
  isStateChangingMethod,
  originGuardResponse,
  resolveRequestHost,
} from "./origin";

describe("isStateChangingMethod", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "post", "Delete"])("treats %s as mutating", (m) => {
    expect(isStateChangingMethod(m)).toBe(true);
  });

  it.each(["GET", "HEAD", "OPTIONS", "get"])("treats %s as safe", (m) => {
    expect(isStateChangingMethod(m)).toBe(false);
  });
});

describe("resolveRequestHost", () => {
  it("prefers x-forwarded-host over host", () => {
    const headers = new Headers({ "x-forwarded-host": "app.example.com", host: "internal:8080" });
    expect(resolveRequestHost(headers, "http://internal:8080/api")).toBe("app.example.com");
  });

  it("uses the host header when no forwarded host", () => {
    const headers = new Headers({ host: "localhost:3000" });
    expect(resolveRequestHost(headers, "http://localhost:3000/x")).toBe("localhost:3000");
  });

  it("falls back to the URL authority when no host header is present", () => {
    expect(resolveRequestHost(new Headers(), "https://preview.vercel.app/x")).toBe(
      "preview.vercel.app"
    );
  });
});

describe("checkSameOrigin", () => {
  const host = "aubreyslist.com";

  it("accepts a matching Origin", () => {
    expect(checkSameOrigin({ origin: "https://aubreyslist.com", referer: null, host })).toEqual({
      ok: true,
    });
  });

  it("accepts a matching Origin including port (dev localhost)", () => {
    expect(
      checkSameOrigin({
        origin: "http://localhost:3000",
        referer: null,
        host: "localhost:3000",
      })
    ).toEqual({ ok: true });
  });

  it("accepts a matching Vercel preview Origin (env-aware, no allowlist)", () => {
    expect(
      checkSameOrigin({
        origin: "https://my-app-git-branch.vercel.app",
        referer: null,
        host: "my-app-git-branch.vercel.app",
      })
    ).toEqual({ ok: true });
  });

  it("rejects a cross-origin Origin", () => {
    const result = checkSameOrigin({ origin: "https://evil.com", referer: null, host });
    expect(result.ok).toBe(false);
  });

  it("rejects the opaque 'null' Origin", () => {
    const result = checkSameOrigin({ origin: "null", referer: null, host });
    expect(result).toEqual({ ok: false, reason: "opaque (null) Origin" });
  });

  it("rejects a malformed Origin", () => {
    const result = checkSameOrigin({ origin: "not-a-url", referer: null, host });
    expect(result).toEqual({ ok: false, reason: "malformed Origin header" });
  });

  it("falls back to a matching Referer when Origin is absent", () => {
    expect(
      checkSameOrigin({ origin: null, referer: "https://aubreyslist.com/listings", host })
    ).toEqual({ ok: true });
  });

  it("rejects a cross-origin Referer", () => {
    const result = checkSameOrigin({
      origin: null,
      referer: "https://evil.com/attack",
      host,
    });
    expect(result.ok).toBe(false);
  });

  it("prefers Origin over Referer (matching Origin wins even with bad Referer)", () => {
    expect(
      checkSameOrigin({
        origin: "https://aubreyslist.com",
        referer: "https://evil.com",
        host,
      })
    ).toEqual({ ok: true });
  });

  it("rejects when both Origin and Referer are missing (policy)", () => {
    expect(checkSameOrigin({ origin: null, referer: null, host })).toEqual({
      ok: false,
      reason: "missing both Origin and Referer",
    });
  });

  it("rejects when the host cannot be determined", () => {
    const result = checkSameOrigin({
      origin: "https://aubreyslist.com",
      referer: null,
      host: null,
    });
    expect(result).toEqual({ ok: false, reason: "request host could not be determined" });
  });
});

describe("originGuardResponse", () => {
  it("allows a safe (GET) request regardless of origin", () => {
    const req = new Request("https://aubreyslist.com/x", {
      headers: { origin: "https://evil.com" },
    });
    expect(originGuardResponse(req)).toBeNull();
  });

  it("allows a same-origin POST", () => {
    const req = new Request("https://aubreyslist.com/_serverFn/x", {
      method: "POST",
      headers: { origin: "https://aubreyslist.com" },
    });
    expect(originGuardResponse(req)).toBeNull();
  });

  it("rejects a cross-origin POST with a JSON 403", async () => {
    const req = new Request("https://aubreyslist.com/_serverFn/x", {
      method: "POST",
      headers: { origin: "https://evil.com" },
    });
    const res = originGuardResponse(req);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
    expect(res?.headers.get("content-type")).toContain("application/json");
    expect(await res?.json()).toEqual({ error: "Forbidden" });
  });

  it("rejects a POST missing both Origin and Referer", () => {
    const req = new Request("https://aubreyslist.com/_serverFn/x", { method: "POST" });
    expect(originGuardResponse(req)?.status).toBe(403);
  });
});
