import { describe, expect, it } from "vitest";
import { type Coords, EARTH_RADIUS_KM, coordsSchema, haversineKm } from "./distance";

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
