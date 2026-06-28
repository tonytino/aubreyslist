/**
 * Geographic distance helpers for the "near me" distance sort (issue #37).
 *
 * CLIENT-SAFE: pure maths + a tiny Zod schema. Imports NO database client and NO
 * server-only code, so both the `/listings` route's geolocation flow (client
 * bundle) and the browse loader/server-fn (server) share ONE definition of what a
 * valid coordinate is and how distance is computed. Keep it free of any
 * `db`/server-only imports.
 *
 * The browse ORDER BY does the ranking haversine in SQL (server-side, against
 * `listings.lat/lng`); this module is the SHARED, testable definition of:
 *   - a validated user coordinate ({@link coordsSchema}, {@link Coords}), and
 *   - the same haversine formula as a pure function ({@link haversineKm}) so the
 *     ordering logic is unit-testable without a database and any UI that wants to
 *     show a "x km away" label has one honest source.
 */

import { z } from "zod";

/** Mean Earth radius in kilometres (used by the haversine great-circle formula). */
export const EARTH_RADIUS_KM = 6371;

/**
 * A user coordinate: a finite latitude/longitude in valid WGS84 ranges. Shared by
 * the route's `?lat=`/`?lng=` params and the browse server-fn validator so an
 * out-of-range or garbage value can never reach the distance ORDER BY.
 *
 * Both are required together — a half-pair is meaningless for distance — so the
 * loader passes EITHER a complete `{ lat, lng }` or nothing (see the optional
 * `userLat`/`userLng` on the browse input, validated independently but only USED
 * as a pair).
 */
export const coordsSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

/** A validated user coordinate (latitude/longitude in degrees). */
export type Coords = z.infer<typeof coordsSchema>;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in kilometres between two coordinates via the haversine
 * formula. Pure and deterministic — the SQL ORDER BY for the distance sort uses
 * the identical formula server-side, so this is the single explainable definition
 * of "distance" shared by tests and any UI label.
 *
 * Symmetric and zero at coincident points; uses {@link EARTH_RADIUS_KM}.
 */
export function haversineKm(a: Coords, b: Coords): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
