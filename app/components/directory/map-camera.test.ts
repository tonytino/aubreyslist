import { describe, expect, it } from "vitest";
import {
  boundsForEntries,
  cameraForBounds,
  type MapPadding,
  MIN_BOUNDS_SPAN_DEG,
} from "./map-camera";

describe("boundsForEntries", () => {
  it("returns the bounding box of all finite coordinates", () => {
    const bounds = boundsForEntries([
      { lat: 39.7, lng: -105.0 },
      { lat: 39.9, lng: -104.8 },
      { lat: 39.6, lng: -104.9 },
    ]);
    expect(bounds).toEqual({ north: 39.9, south: 39.6, east: -104.8, west: -105.0 });
  });

  it("returns null when no entry has usable coordinates", () => {
    expect(boundsForEntries([])).toBeNull();
    expect(boundsForEntries([{ lat: Number.NaN, lng: -105 }])).toBeNull();
    expect(boundsForEntries([{ lat: 39.7, lng: Number.POSITIVE_INFINITY }])).toBeNull();
  });

  it("skips non-finite coordinates instead of poisoning the box", () => {
    const bounds = boundsForEntries([
      { lat: 39.7, lng: -105.0 },
      { lat: Number.NaN, lng: -1 },
      { lat: 39.9, lng: -104.8 },
    ]);
    expect(bounds).toEqual({ north: 39.9, south: 39.7, east: -104.8, west: -105.0 });
  });

  it("widens a single-pin (degenerate) box to the minimum span, centred on the pin", () => {
    const bounds = boundsForEntries([{ lat: 39.75, lng: -104.99 }]);
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    expect(bounds.north - bounds.south).toBeCloseTo(MIN_BOUNDS_SPAN_DEG, 10);
    expect(bounds.east - bounds.west).toBeCloseTo(MIN_BOUNDS_SPAN_DEG, 10);
    expect((bounds.north + bounds.south) / 2).toBeCloseTo(39.75, 10);
    expect((bounds.east + bounds.west) / 2).toBeCloseTo(-104.99, 10);
  });

  it("widens only the degenerate axis when pins sit on a line", () => {
    const bounds = boundsForEntries([
      { lat: 39.6, lng: -104.9 },
      { lat: 39.9, lng: -104.9 },
    ]);
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    // Latitude span is real; longitude span was zero and gets the floor.
    expect(bounds.north - bounds.south).toBeCloseTo(0.3, 10);
    expect(bounds.east - bounds.west).toBeCloseTo(MIN_BOUNDS_SPAN_DEG, 10);
  });
});

describe("cameraForBounds", () => {
  const size = { width: 800, height: 600 };
  const noPadding: MapPadding = { top: 0, right: 0, bottom: 0, left: 0 };
  const denver = { north: 39.95, south: 39.55, east: -104.75, west: -105.15 };

  it("centres on the bounds midpoint under symmetric (zero) padding", () => {
    const { center } = cameraForBounds(denver, size, noPadding);
    expect(center.lng).toBeCloseTo((-104.75 + -105.15) / 2, 6);
    // Mercator latitude midpoint ≈ arithmetic midpoint at this scale.
    expect(center.lat).toBeCloseTo((39.95 + 39.55) / 2, 2);
  });

  it("produces a zoom that fits the bounds inside the viewport", () => {
    const { zoom } = cameraForBounds(denver, size, noPadding);
    // Metro Denver in an 800×600 viewport is a city-level zoom.
    expect(zoom).toBeGreaterThan(8);
    expect(zoom).toBeLessThan(13);
    // The fit must be limited by the tighter axis: doubling the viewport adds
    // exactly one zoom level.
    const twice = cameraForBounds(denver, { width: 1600, height: 1200 }, noPadding);
    expect(twice.zoom).toBeCloseTo(zoom + 1, 6);
  });

  it("zooms out (never in) when padding shrinks the usable content box", () => {
    const padded = cameraForBounds(denver, size, { top: 48, right: 48, bottom: 200, left: 48 });
    const bare = cameraForBounds(denver, size, noPadding);
    expect(padded.zoom).toBeLessThan(bare.zoom);
  });

  it("shifts the centre north under heavy bottom padding (bounds centred above the carousel band)", () => {
    const padded = cameraForBounds(denver, size, { top: 0, right: 0, bottom: 200, left: 0 });
    const bare = cameraForBounds(denver, size, noPadding);
    // The camera centre moves SOUTH of the bounds midpoint so the bounds sit
    // centred in the upper (unpadded) part of the viewport.
    expect(padded.center.lat).toBeLessThan(bare.center.lat);
    expect(padded.center.lng).toBeCloseTo(bare.center.lng, 10);
  });

  it("clamps zoom to the Maps JS range and stays finite for degenerate inputs", () => {
    // A whole-world box in a tiny viewport → zoom floors at 0.
    const world = cameraForBounds(
      { north: 85, south: -85, east: 180, west: -180 },
      { width: 10, height: 10 },
      noPadding
    );
    expect(world.zoom).toBe(0);
    // A zero-size box → zoom caps at 21 instead of Infinity.
    const point = cameraForBounds(
      { north: 39.75, south: 39.75, east: -104.99, west: -104.99 },
      size,
      noPadding
    );
    expect(point.zoom).toBe(21);
    expect(Number.isFinite(point.center.lat)).toBe(true);
    expect(Number.isFinite(point.center.lng)).toBe(true);
    // Padding larger than the viewport must not produce NaN either.
    const overPadded = cameraForBounds(
      denver,
      { width: 100, height: 100 },
      {
        top: 200,
        right: 200,
        bottom: 200,
        left: 200,
      }
    );
    expect(Number.isFinite(overPadded.zoom)).toBe(true);
  });
});
