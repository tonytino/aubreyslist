import { describe, expect, it } from "vitest";
import { DENVER_BBOX, projectToMap } from "./map-projection";

/**
 * Tests for the lat/lng → map-percentage projection (AUB-61, Phase 2b). Pins are
 * placed from REAL coordinates via a fixed metro-Denver bounding box, so the
 * projection must be monotonic (east → higher left%, north → lower top%), clamped
 * to [0,100], and safe for garbage input (never off-screen / NaN).
 */

describe("projectToMap", () => {
  it("maps the box centre to roughly 50/50", () => {
    const midLat = (DENVER_BBOX.minLat + DENVER_BBOX.maxLat) / 2;
    const midLng = (DENVER_BBOX.minLng + DENVER_BBOX.maxLng) / 2;
    const { left, top } = projectToMap(midLat, midLng);
    expect(left).toBeCloseTo(50, 5);
    expect(top).toBeCloseTo(50, 5);
  });

  it("maps the north-west corner to the top-left", () => {
    const { left, top } = projectToMap(DENVER_BBOX.maxLat, DENVER_BBOX.minLng);
    expect(left).toBeCloseTo(0, 5);
    expect(top).toBeCloseTo(0, 5);
  });

  it("maps the south-east corner to the bottom-right", () => {
    const { left, top } = projectToMap(DENVER_BBOX.minLat, DENVER_BBOX.maxLng);
    expect(left).toBeCloseTo(100, 5);
    expect(top).toBeCloseTo(100, 5);
  });

  it("moves east → larger left%, and north → smaller top%", () => {
    const west = projectToMap(39.75, -105.1);
    const east = projectToMap(39.75, -104.8);
    expect(east.left).toBeGreaterThan(west.left);

    const south = projectToMap(39.6, -104.95);
    const north = projectToMap(39.9, -104.95);
    expect(north.top).toBeLessThan(south.top);
  });

  it("clamps out-of-box coordinates to the [0,100] edges", () => {
    const farNorthWest = projectToMap(80, -160);
    expect(farNorthWest.left).toBe(0);
    expect(farNorthWest.top).toBe(0);
    const farSouthEast = projectToMap(-80, 20);
    expect(farSouthEast.left).toBe(100);
    expect(farSouthEast.top).toBe(100);
  });

  it("falls back to the centre for non-finite coordinates (never NaN/off-screen)", () => {
    expect(projectToMap(Number.NaN, -104.9)).toEqual({ left: 50, top: 50 });
    expect(projectToMap(39.7, Number.POSITIVE_INFINITY)).toEqual({ left: 50, top: 50 });
  });
});
