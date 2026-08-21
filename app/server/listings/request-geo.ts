/**
 * Coarse visitor location from the request itself, for the "near me" default.
 *
 * Vercel resolves the client IP to an approximate point and forwards it as
 * `x-vercel-ip-latitude` / `x-vercel-ip-longitude` (city-level, and wrong
 * behind a VPN). It costs nothing, needs no browser permission, and lets the
 * distance sort produce a sensible first paint before the browser has
 * answered — or at all, if it never does.
 *
 * The precise browser reading always wins when the client sends one. This is
 * only the anchor of last resort before the sort degrades entirely.
 *
 * Derived per request and never stored: it is read off the headers, used to
 * order one page, and discarded.
 */

import { type Coords, coordsSchema } from "~/listings/distance";

const LATITUDE_HEADER = "x-vercel-ip-latitude";
const LONGITUDE_HEADER = "x-vercel-ip-longitude";

/**
 * The coarse coordinate a request carries, or `undefined` when the headers are
 * absent (local dev, a non-Vercel host) or unparseable. Never throws: a
 * missing anchor is a normal outcome, not an error.
 */
export function coarseCoordsFromHeaders(headers: Headers): Coords | undefined {
  const lat = Number(headers.get(LATITUDE_HEADER));
  const lng = Number(headers.get(LONGITUDE_HEADER));
  // `Number("")` and `Number(null)` are both 0, a valid coordinate — so an
  // absent header would otherwise anchor every visitor off West Africa.
  if (!headers.get(LATITUDE_HEADER) || !headers.get(LONGITUDE_HEADER)) {
    return undefined;
  }
  const parsed = coordsSchema.safeParse({ lat, lng });
  return parsed.success ? parsed.data : undefined;
}
