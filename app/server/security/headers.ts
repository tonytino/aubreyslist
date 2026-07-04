import type { MiddlewareHandler } from "hono";
import { cookieSecure } from "~/server/auth/session";

/**
 * Security response headers (AUB-162).
 *
 * A single source of truth for the response-hardening header set, applied to
 * BOTH backend surfaces (see `docs/agents/api.md` for the two-layer model):
 *
 * - the Hono `/api/*` surface, via {@link honoSecurityHeaders} mounted ahead of
 *   the routes in `app/server/index.ts`; and
 * - SSR/document + server-function responses, via the global request middleware
 *   in `app/start.ts`, which calls {@link applySecurityHeaders}.
 *
 * Keeping the header VALUES in one module (rather than configuring
 * `hono/secure-headers` on one surface and hand-rolling the other) guarantees
 * the two surfaces can never drift apart. This is the "equivalent" the AUB-162
 * acceptance criteria allow in place of `secureHeaders()`.
 */

/**
 * Content-Security-Policy directives.
 *
 * Kept as a directive→sources map for readability; serialized by
 * {@link contentSecurityPolicy}. Everything defaults to `'self'`; each widening
 * below is justified against an actual runtime need.
 *
 * `'unsafe-inline'` (script/style) is the one unavoidable exception, documented
 * inline. `'unsafe-eval'` is deliberately never granted.
 */
const CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  "default-src": ["'self'"],
  // Lock the document base URL so injected markup can't repoint relative URLs.
  "base-uri": ["'self'"],
  // No <object>/<embed>/<applet> — legacy plugin vectors we never use.
  "object-src": ["'none'"],
  // Clickjacking defense (paired with X-Frame-Options: DENY for old browsers).
  "frame-ancestors": ["'none'"],
  // Forms only ever post back to us (e.g. the preview dev-login form).
  "form-action": ["'self'"],
  // Listing photos + Google account avatars are served from arbitrary HTTPS
  // hosts (e.g. lh3.googleusercontent.com, places.googleapis.com); `data:`
  // covers inline placeholder/gradient tiles. Broad `https:` here is low risk
  // for images.
  "img-src": ["'self'", "data:", "https:"],
  // Google Fonts webfont files (the stylesheet lives under style-src below).
  "font-src": ["'self'", "https://fonts.gstatic.com"],
  // `'unsafe-inline'`: React and the framework emit inline `style=""` attributes
  // and <style> blocks during hydration that we cannot nonce in this TanStack
  // Start version. `fonts.googleapis.com` serves the webfont stylesheet.
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  // `'unsafe-inline'`: unavoidable here — TanStack Start injects inline
  // hydration/dehydration scripts via <Scripts/>, plus the app ships a tiny
  // inline no-FOUC theme IIFE and a JSON-LD <script> in the document head
  // (app/routes/__root.tsx). None can carry a nonce in this framework version,
  // so inline scripts must be allowed; `'unsafe-eval'` is still withheld.
  // `va.vercel-scripts.com` serves the Vercel Analytics client on preview/dev.
  "script-src": ["'self'", "'unsafe-inline'", "https://va.vercel-scripts.com"],
  // Sentry error ingestion + Vercel Analytics beacon. Google OAuth is a
  // top-level server-side 302 redirect (not a fetch/XHR/iframe), so it is NOT
  // subject to connect-src and needs no entry here.
  "connect-src": [
    "'self'",
    "https://*.ingest.us.sentry.io",
    "https://*.sentry.io",
    "https://va.vercel-scripts.com",
  ],
};

/** Serialize {@link CSP_DIRECTIVES} into a Content-Security-Policy header value. */
export function contentSecurityPolicy(): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
    .join("; ");
}

/**
 * Conservative Permissions-Policy: deny powerful features we never use, and
 * scope the one we do (geolocation, for the "near me" distance sort) to same
 * origin. `interest-cohort`/`browsing-topics` opt out of ad-topic tracking.
 */
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "browsing-topics=()",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  "geolocation=(self)",
  "gyroscope=()",
  "interest-cohort=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "usb=()",
].join(", ");

/**
 * Strict-Transport-Security value: 2 years, include subdomains, preload-ready.
 * Only emitted when {@link hstsEnabled} is true.
 */
const STRICT_TRANSPORT_SECURITY = "max-age=63072000; includeSubDomains; preload";

/**
 * Whether to emit HSTS. Mirrors {@link cookieSecure} (production only) so we
 * never send HSTS over plain-HTTP localhost, where it would pin the dev origin
 * to HTTPS. Tolerates an unconfigured env (e.g. unit tests without
 * `DATABASE_URL`, where `getEnv()` throws) by treating it as non-production.
 */
export function hstsEnabled(): boolean {
  try {
    return cookieSecure();
  } catch {
    return false;
  }
}

/**
 * Build the full security header set. Pure and env-free — the HSTS decision is
 * injected via `hsts` so both call sites (and tests) stay deterministic.
 */
export function buildSecurityHeaders({ hsts }: { hsts: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": contentSecurityPolicy(),
    // Block MIME sniffing (defends against content-type confusion).
    "X-Content-Type-Options": "nosniff",
    // Legacy clickjacking defense; CSP frame-ancestors covers modern browsers.
    "X-Frame-Options": "DENY",
    // Send only the origin cross-site; full path stays same-origin.
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": PERMISSIONS_POLICY,
  };
  if (hsts) {
    headers["Strict-Transport-Security"] = STRICT_TRANSPORT_SECURITY;
  }
  return headers;
}

/**
 * Apply the security header set onto an existing `Response` (mutates its
 * `headers`). Used by the global request middleware for SSR/document and
 * server-function responses.
 */
export function applySecurityHeaders(response: Response, { hsts }: { hsts: boolean }): void {
  for (const [name, value] of Object.entries(buildSecurityHeaders({ hsts }))) {
    response.headers.set(name, value);
  }
}

/**
 * Hono middleware that stamps the security headers onto every `/api/*` response
 * (including error/404 responses, since it wraps `next()`). Mount it first in
 * `app/server/index.ts` so it wraps all downstream handlers.
 */
export function honoSecurityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(buildSecurityHeaders({ hsts: hstsEnabled() }))) {
      c.res.headers.set(name, value);
    }
  };
}
