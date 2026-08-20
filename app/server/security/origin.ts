import type { MiddlewareHandler } from "hono";

/**
 * Origin/Referer same-origin check for state-changing requests.
 *
 * Defense-in-depth on top of the `SameSite=Lax` session cookie: a
 * cross-site-forged POST (classic CSRF) is rejected with `403` before any
 * route handler or DB work runs. Applied centrally on both backend surfaces
 * (`docs/agents/api.md`):
 *
 * - the Hono `/api/*` surface, via {@link honoOriginCheck}; and
 * - `createServerFn` POSTs, via the global request middleware (which calls
 *   {@link originGuardResponse}).
 *
 * Individual write handlers are intentionally not touched — the guarantee
 * lives in one place per surface.
 *
 * ## Policy
 *
 * For a state-changing method (POST/PUT/PATCH/DELETE):
 *
 * 1. Prefer the `Origin` header; compare its authority (host:port) to the
 *    request's own host.
 * 2. Fall back to `Referer` when `Origin` is absent.
 * 3. Reject when neither is present, when the present one mismatches, or when
 *    `Origin` is the opaque value `"null"`.
 *
 * Comparing against the request's own host (not a hardcoded allowlist) makes
 * this environment-aware for free: it passes on `localhost:3000` and on
 * `*.vercel.app` preview URLs alike, because the browser's `Origin` always
 * reflects the host it is talking to.
 *
 * Note: this rejects non-browser API clients that omit both headers (e.g. a
 * future server-to-server webhook). Such callers must be exempted explicitly
 * (e.g. by signature verification) when added.
 */

/** HTTP methods that mutate state and therefore require the origin check. */
const STATE_CHANGING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Whether a method mutates state (case-insensitive). */
export function isStateChangingMethod(method: string): boolean {
  return STATE_CHANGING_METHODS.has(method.toUpperCase());
}

/** Extract the authority (host:port) from an absolute URL, or `null` if unparseable. */
function authorityOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export type OriginCheckResult = { ok: true } | { ok: false; reason: string };

/**
 * Pure same-origin decision. Compares the `Origin` (preferred) or `Referer`
 * (fallback) authority against the expected request host.
 *
 * @param origin   the `Origin` request header (or null/undefined if absent)
 * @param referer  the `Referer` request header (or null/undefined if absent)
 * @param host     the request's own authority (host:port), e.g. from the
 *                 `X-Forwarded-Host` or `Host` header
 */
export function checkSameOrigin(input: {
  origin: string | null | undefined;
  referer: string | null | undefined;
  host: string | null | undefined;
}): OriginCheckResult {
  const { origin, referer, host } = input;

  if (!host) {
    return { ok: false, reason: "request host could not be determined" };
  }

  if (origin) {
    // "null" is the opaque origin browsers send from sandboxed/privacy contexts;
    // treat it as cross-origin rather than trying to match it.
    if (origin === "null") {
      return { ok: false, reason: "opaque (null) Origin" };
    }
    const originHost = authorityOf(origin);
    if (originHost === null) {
      return { ok: false, reason: "malformed Origin header" };
    }
    return originHost === host
      ? { ok: true }
      : { ok: false, reason: `Origin ${originHost} does not match host ${host}` };
  }

  if (referer) {
    const refererHost = authorityOf(referer);
    if (refererHost === null) {
      return { ok: false, reason: "malformed Referer header" };
    }
    return refererHost === host
      ? { ok: true }
      : { ok: false, reason: `Referer ${refererHost} does not match host ${host}` };
  }

  return { ok: false, reason: "missing both Origin and Referer" };
}

/**
 * Resolve the request's own authority (host:port). Prefers the proxy-forwarded
 * host, then the `Host` header, and finally the URL authority — the last is the
 * reliable fallback since a `fetch` `Request` created from a URL carries no
 * `Host` header.
 */
export function resolveRequestHost(headers: Headers, url: string): string | null {
  return headers.get("x-forwarded-host") ?? headers.get("host") ?? authorityOf(url);
}

/**
 * Evaluate the origin guard for a raw `Request` (the server-function surface).
 * Returns a `403` `Response` when the request is a state-changing cross-origin
 * request; returns `null` when the request is allowed (safe method or verified
 * same-origin). The 403 body is JSON so it matches the server-fn error shape.
 */
export function originGuardResponse(request: Request): Response | null {
  if (!isStateChangingMethod(request.method)) {
    return null;
  }
  const result = checkSameOrigin({
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    host: resolveRequestHost(request.headers, request.url),
  });
  if (result.ok) {
    return null;
  }
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Hono middleware enforcing the origin check on state-changing `/api/*`
 * requests. Runs before the route handlers, so a rejected request never reaches
 * any DB work. Returns a `403` JSON response directly (rather than throwing) so
 * an outer response-headers middleware still stamps its headers onto it — this
 * mirrors how the framework's own CSRF middleware rejects.
 */
export function honoOriginCheck(): MiddlewareHandler {
  return async (c, next) => {
    if (isStateChangingMethod(c.req.method)) {
      const result = checkSameOrigin({
        origin: c.req.header("origin"),
        referer: c.req.header("referer"),
        host: resolveRequestHost(c.req.raw.headers, c.req.url),
      });
      if (!result.ok) {
        return c.json({ error: "Forbidden" }, 403);
      }
    }
    return await next();
  };
}
