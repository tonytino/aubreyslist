/**
 * Geographic distance helpers for the "near me" distance sort.
 *
 * Client-safe: pure maths + a tiny Zod schema, shared so the route's
 * geolocation flow and the browse loader/server-fn use one definition of a
 * valid coordinate and of distance. Keep it free of db/server-only imports.
 *
 * The browse ORDER BY runs the ranking haversine in SQL; {@link haversineKm}
 * is the same formula as a pure function, so the ordering logic is testable
 * without a database and any "x km away" label has one honest source.
 */

import { z } from "zod";

/** Mean Earth radius in kilometres (used by the haversine great-circle formula). */
export const EARTH_RADIUS_KM = 6371;

/**
 * A user coordinate: a finite latitude/longitude in valid WGS84 ranges.
 * Shared by the route's in-memory location state and the browse server-fn
 * validator, so an out-of-range or garbage value can never reach the distance
 * ORDER BY.
 *
 * A half-pair is meaningless for distance, so the loader passes either a
 * complete `{ lat, lng }` or nothing.
 */
export const coordsSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

/** A validated user coordinate (latitude/longitude in degrees). */
export type Coords = z.infer<typeof coordsSchema>;

/**
 * Denver Union Station — the default browse origin for the distance-radius
 * filter when geolocation is unavailable (denied, unsupported, or SSR).
 * Anchoring to a stable downtown landmark keeps the "Within N mi" filter
 * meaningful for non-located visitors instead of silently showing everything.
 */
export const UNION_STATION: Coords = { lat: 39.7539, lng: -104.9999 };

/**
 * The selectable search-radius options, in miles. Presented in the
 * {@link DistanceSelector} and validated on the `?radius=` URL param; any
 * value outside this set degrades to {@link DEFAULT_RADIUS_MILES}.
 */
export const DISTANCE_RADIUS_OPTIONS = [5, 10, 15, 20, 25, 50] as const;

/** A selectable radius (one of {@link DISTANCE_RADIUS_OPTIONS}), in miles. */
export type RadiusMiles = (typeof DISTANCE_RADIUS_OPTIONS)[number];

/**
 * The default search radius (miles) when none is chosen. Deliberately NOT the
 * widest option: the un-located default view keeps the dense metro core; the
 * 50-mile ring (Boulder, Longmont, Castle Rock) is opt-in via the selector.
 */
export const DEFAULT_RADIUS_MILES: RadiusMiles = 25;

/**
 * Decimal places kept when a browser reading leaves the device: 2, about 1.1
 * km of latitude. Enough to rank a metro's restaurants by distance, far too
 * coarse to place someone at an address.
 */
export const COARSE_COORD_DECIMALS = 2;

/**
 * Round a reading to {@link COARSE_COORD_DECIMALS} before it leaves the
 * browser. The precise fix never goes to the server, into a query key, or
 * anywhere else it could be logged.
 *
 * Rounding, not truncation, so the error stays symmetric (at most half a step
 * in each axis) instead of always pulling toward the equator and the meridian.
 */
export function coarsenCoords({ lat, lng }: Coords): Coords {
  const factor = 10 ** COARSE_COORD_DECIMALS;
  return {
    lat: Math.round(lat * factor) / factor,
    lng: Math.round(lng * factor) / factor,
  };
}

/** Statute miles → kilometres (1 mile = 1.609344 km, exact). */
export function milesToKm(miles: number): number {
  return miles * 1.609344;
}

/**
 * Coerce a `?radius=` value to a valid {@link DISTANCE_RADIUS_OPTIONS} option,
 * falling back to {@link DEFAULT_RADIUS_MILES} for anything unrecognized.
 * Pure/client-safe so route param handling and server validation share one
 * definition of a valid radius.
 */
export function parseRadiusMiles(value: unknown): RadiusMiles {
  const n = typeof value === "string" ? Number(value) : value;
  return (DISTANCE_RADIUS_OPTIONS as readonly number[]).includes(n as number)
    ? (n as RadiusMiles)
    : DEFAULT_RADIUS_MILES;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in kilometres via the haversine formula. Pure and
 * deterministic; the distance sort's SQL ORDER BY uses the identical formula,
 * so this is the single explainable definition of "distance".
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
