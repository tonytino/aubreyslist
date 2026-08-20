/**
 * URL-scheme guard shared by the add-listing intake validator and the listing
 * detail render sink: only `http:`/`https:` may land in an anchor href.
 * `z.string().url()` alone accepts `javascript:` and `data:`, a stored-XSS
 * vector once rendered into an `href`. Applied at intake and again at the
 * sink (defence in depth).
 *
 * A plain regex on the leading scheme, not the `URL` parser: total (never
 * throws), identical on server and browser, easy to audit.
 */
export function isHttpUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}
