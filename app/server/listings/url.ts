/**
 * Shared URL-scheme guard for listing links (issue #90).
 *
 * Both the add-listing intake validator and the listing detail render sink need
 * the same notion of "a URL safe to put in an anchor href": an `http:`/`https:`
 * scheme only. A `z.string().url()` check alone accepts dangerous schemes like
 * `javascript:` and `data:`, which — rendered into an `href` — is a stored-XSS /
 * untrusted-navigation vector. Restricting to http(s) at intake AND defensively
 * guarding the sink (defence-in-depth) closes that.
 *
 * Intentionally a plain regex on the leading scheme rather than the `URL` parser:
 * it is total (never throws on garbage input), works identically on server and
 * in the browser, and is trivial to reason about for a security control.
 */
export function isHttpUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}
