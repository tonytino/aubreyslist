import { describe, expect, it } from "vitest";
import { applySecurityHeaders, buildSecurityHeaders, contentSecurityPolicy } from "./headers";

describe("contentSecurityPolicy", () => {
  const csp = contentSecurityPolicy();

  it("locks down the dangerous defaults", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
  });

  it("permits the actual third-party needs", () => {
    // Sentry ingest + Vercel Analytics beacon/script.
    expect(csp).toContain("https://*.ingest.us.sentry.io");
    expect(csp).toContain("https://va.vercel-scripts.com");
    // Google Fonts (stylesheet + font files).
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("https://fonts.gstatic.com");
  });

  it("permits the Maps JavaScript API for the directory map (AUB-111)", () => {
    // The Maps JS loader + libraries (script) and its tile/attribution
    // fetches (connect) both come from maps.googleapis.com.
    expect(csp).toMatch(/script-src [^;]*https:\/\/maps\.googleapis\.com/);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/maps\.googleapis\.com/);
    // Static map assets + map-label webfonts are fetched via XHR.
    expect(csp).toMatch(/connect-src [^;]*https:\/\/maps\.gstatic\.com/);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/fonts\.gstatic\.com/);
    // The vector renderer spawns blob: workers — scoped to worker-src ONLY,
    // never script-src (which would loosen script execution globally).
    expect(csp).toMatch(/worker-src 'self' blob:/);
    expect(csp).not.toMatch(/script-src [^;]*blob:/);
  });

  it("never grants unsafe-eval", () => {
    expect(csp).not.toContain("unsafe-eval");
  });

  it("permits the Maps Embed API iframe for the listing-detail map (AUB-216, ADR-014)", () => {
    // Pinned EXACTLY: the frame-src directive is the Embed API's iframe
    // origin and nothing else — any future widening (another host, 'self', a
    // wildcard) must consciously fail this assertion and update it.
    expect(csp).toMatch(/frame-src https:\/\/www\.google\.com(;|$)/);
  });
});

describe("buildSecurityHeaders", () => {
  it("sets the core hardening headers", () => {
    const h = buildSecurityHeaders({ hsts: false });
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("camera=()");
    expect(h["Permissions-Policy"]).toContain("geolocation=(self)");
    expect(h["Content-Security-Policy"]).toBe(contentSecurityPolicy());
  });

  it("omits HSTS when not enabled (non-production / plain HTTP)", () => {
    expect(buildSecurityHeaders({ hsts: false })["Strict-Transport-Security"]).toBeUndefined();
  });

  it("emits HSTS when enabled (production HTTPS)", () => {
    const h = buildSecurityHeaders({ hsts: true });
    expect(h["Strict-Transport-Security"]).toContain("max-age=");
    expect(h["Strict-Transport-Security"]).toContain("includeSubDomains");
  });
});

describe("applySecurityHeaders", () => {
  // This is exactly what the global request middleware in `app/start.ts` calls
  // on SSR/document (page) responses, so asserting it here covers the page
  // surface without booting the full SSR pipeline.
  it("stamps the header set onto an SSR/document (page) response", () => {
    const page = new Response("<!doctype html><title>page</title>", {
      headers: { "content-type": "text/html" },
    });
    applySecurityHeaders(page, { hsts: true });
    expect(page.headers.get("content-security-policy")).toBe(contentSecurityPolicy());
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(page.headers.get("permissions-policy")).toContain("microphone=()");
    expect(page.headers.get("strict-transport-security")).toContain("max-age=");
    // The original response content-type is preserved.
    expect(page.headers.get("content-type")).toBe("text/html");
  });
});
