import { describe, expect, it } from "vitest";
import {
  type Coords,
  coordsSchema,
  DEFAULT_RADIUS_MILES,
  DISTANCE_RADIUS_OPTIONS,
  EARTH_RADIUS_KM,
  haversineKm,
  milesToKm,
  parseRadiusMiles,
  UNION_STATION,
} from "./distance";

/**
 * Tests for the client-safe distance helpers (#37) — the shared, explainable
 * definition of a valid coordinate and the haversine distance the "near me" sort
 * ranks by.
 */

const DENVER: Coords = { lat: 39.7392, lng: -104.9903 };
const BOULDER: Coords = { lat: 40.015, lng: -105.2705 };
const NYC: Coords = { lat: 40.7128, lng: -74.006 };

describe("coordsSchema", () => {
  it("accepts in-range coordinates", () => {
    expect(coordsSchema.safeParse(DENVER).success).toBe(true);
    expect(coordsSchema.safeParse({ lat: -90, lng: 180 }).success).toBe(true);
    expect(coordsSchema.safeParse({ lat: 90, lng: -180 }).success).toBe(true);
  });

  it("rejects out-of-range latitude/longitude", () => {
    expect(coordsSchema.safeParse({ lat: 91, lng: 0 }).success).toBe(false);
    expect(coordsSchema.safeParse({ lat: 0, lng: 181 }).success).toBe(false);
    expect(coordsSchema.safeParse({ lat: -91, lng: 0 }).success).toBe(false);
  });

  it("rejects non-finite / non-numeric values", () => {
    expect(coordsSchema.safeParse({ lat: Number.NaN, lng: 0 }).success).toBe(false);
    expect(coordsSchema.safeParse({ lat: Number.POSITIVE_INFINITY, lng: 0 }).success).toBe(false);
    expect(coordsSchema.safeParse({ lat: "1", lng: 0 }).success).toBe(false);
  });
});

describe("haversineKm", () => {
  it("is zero between coincident points", () => {
    expect(haversineKm(DENVER, DENVER)).toBeCloseTo(0, 6);
  });

  it("is symmetric", () => {
    expect(haversineKm(DENVER, NYC)).toBeCloseTo(haversineKm(NYC, DENVER), 6);
  });

  it("computes a known great-circle distance (Denver↔Boulder ≈ 39 km)", () => {
    // Real-world reference: Denver to Boulder is roughly 38–40 km as the crow flies.
    expect(haversineKm(DENVER, BOULDER)).toBeGreaterThan(35);
    expect(haversineKm(DENVER, BOULDER)).toBeLessThan(45);
  });

  it("computes a known long-haul distance (Denver↔NYC ≈ 2620 km)", () => {
    expect(haversineKm(DENVER, NYC)).toBeGreaterThan(2500);
    expect(haversineKm(DENVER, NYC)).toBeLessThan(2750);
  });

  it("ranks a nearer point below a farther one (the ordering the sort relies on)", () => {
    // Boulder is far closer to Denver than NYC — the distance sort must order it first.
    expect(haversineKm(DENVER, BOULDER)).toBeLessThan(haversineKm(DENVER, NYC));
  });

  it("never exceeds half the Earth's circumference (asin is clamped)", () => {
    const antipode: Coords = { lat: -DENVER.lat, lng: DENVER.lng + 180 };
    const half = Math.PI * EARTH_RADIUS_KM;
    expect(haversineKm(DENVER, antipode)).toBeLessThanOrEqual(half + 1);
  });
});

// --- distance-radius filter helpers (user feedback #7) ---------------------

describe("UNION_STATION", () => {
  it("is a valid coordinate near downtown Denver (the default browse origin)", () => {
    expect(coordsSchema.safeParse(UNION_STATION).success).toBe(true);
    // Sanity: within a few km of the Denver reference point above.
    expect(haversineKm(UNION_STATION, DENVER)).toBeLessThan(5);
  });
});

describe("milesToKm", () => {
  it("converts miles to kilometres by the exact factor", () => {
    expect(milesToKm(1)).toBeCloseTo(1.609344, 6);
    expect(milesToKm(5)).toBeCloseTo(8.04672, 6);
    expect(milesToKm(0)).toBe(0);
  });
});

describe("parseRadiusMiles", () => {
  it("accepts each valid option (number or string form)", () => {
    for (const option of DISTANCE_RADIUS_OPTIONS) {
      expect(parseRadiusMiles(option)).toBe(option);
      expect(parseRadiusMiles(String(option))).toBe(option);
    }
  });

  it("falls back to the default for missing/garbage/off-list values", () => {
    expect(parseRadiusMiles(undefined)).toBe(DEFAULT_RADIUS_MILES);
    expect(parseRadiusMiles(null)).toBe(DEFAULT_RADIUS_MILES);
    expect(parseRadiusMiles("banana")).toBe(DEFAULT_RADIUS_MILES);
    expect(parseRadiusMiles(7)).toBe(DEFAULT_RADIUS_MILES); // not one of the options
    expect(parseRadiusMiles(1000)).toBe(DEFAULT_RADIUS_MILES);
  });

  it("uses the widest option (25 mi) as the default", () => {
    expect(DEFAULT_RADIUS_MILES).toBe(25);
    expect(DISTANCE_RADIUS_OPTIONS).toContain(DEFAULT_RADIUS_MILES);
  });
});
