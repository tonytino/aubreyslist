/**
 * Client-safe builder for the Google Place photo media-proxy URL.
 *
 * Set as an `<img src>`; the browser GETs the `/api/places/photo` Hono route,
 * which resolves the transient photo token to Google's short-lived media URL
 * server-side (the key never leaves the server, ADR-014) and 302s to it. An
 * image URL, not a data fetch — the frontend never `fetch`es it, so the
 * RPC-client rule for Hono routes doesn't apply.
 *
 * `photoToken` is the Google photo resource name
 * (`places/{placeId}/photos/{resource}`). It contains slashes, so it must
 * travel encoded in the query string.
 */
export function placePhotoProxyUrl(photoToken: string, maxWidthPx: number): string {
  return `/api/places/photo?name=${encodeURIComponent(photoToken)}&maxWidthPx=${maxWidthPx}`;
}
