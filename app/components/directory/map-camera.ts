/**
 * Pure bounds/camera math for the real directory map (AUB-111).
 *
 * `boundsForEntries` computes the lat/lng bounding box of the current result
 * pins (the initial camera, the recenter-FAB target, and the refit-on-filter
 * target all fit this box). `cameraForBounds` converts that box into an
 * explicit `{ center, zoom }` for `map.moveCamera(...)` — the INSTANT camera
 * write used when the visitor prefers reduced motion (Maps JS `fitBounds` can
 * animate; `moveCamera` never does).
 *
 * CLIENT-SAFE + PURE: no `db`/server import, no React, no `google.maps`
 * runtime dependency — just Web-Mercator arithmetic, so it is trivially
 * unit-testable and safe in the browse client bundle (same contract as
 * `map-projection.ts`).
 */

/** A lat/lng box, structurally identical to `google.maps.LatLngBoundsLiteral`. */
export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/** Per-side pixel padding, structurally identical to `google.maps.Padding`. */
export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Minimum span (degrees) a computed box is widened to, per axis. A single pin
 * (or several co-located pins) would otherwise produce a degenerate box that
 * `fitBounds`/`cameraForBounds` zooms into at maximum level — street-corner
 * close, disorienting, and useless as an overview. ~0.01° ≈ 1.1 km of
 * latitude: close enough to see the block, wide enough to orient.
 */
export const MIN_BOUNDS_SPAN_DEG = 0.01;

/**
 * Bounding box of every entry with finite coordinates, widened to
 * {@link MIN_BOUNDS_SPAN_DEG} per axis. Returns `null` when no entry has
 * usable coordinates (callers keep the current/default camera — never a fake
 * fit). Non-finite coordinates are skipped (mirroring `projectToMap`'s
 * degrade-honestly stance) rather than poisoning the box with `NaN`.
 */
export function boundsForEntries(
  entries: readonly { lat: number; lng: number }[]
): MapBounds | null {
  let north = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let west = Number.POSITIVE_INFINITY;
  for (const { lat, lng } of entries) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat > north) north = lat;
    if (lat < south) south = lat;
    if (lng > east) east = lng;
    if (lng < west) west = lng;
  }
  if (!Number.isFinite(north) || !Number.isFinite(east)) {
    return null;
  }
  // Widen degenerate spans symmetrically around their midpoint.
  if (north - south < MIN_BOUNDS_SPAN_DEG) {
    const mid = (north + south) / 2;
    north = mid + MIN_BOUNDS_SPAN_DEG / 2;
    south = mid - MIN_BOUNDS_SPAN_DEG / 2;
  }
  if (east - west < MIN_BOUNDS_SPAN_DEG) {
    const mid = (east + west) / 2;
    east = mid + MIN_BOUNDS_SPAN_DEG / 2;
    west = mid - MIN_BOUNDS_SPAN_DEG / 2;
  }
  return { north, south, east, west };
}

/** Maps JS zoom limits (0 = whole world; ~22 is the practical street max). */
const MIN_ZOOM = 0;
const MAX_ZOOM = 21;

/** World size in pixels at zoom 0 (the Web-Mercator base tile). */
const WORLD_PX = 256;

/** Longitude → world-x pixel at zoom 0 ([0, 256], linear). */
function lngToWorldX(lng: number): number {
  return ((lng + 180) / 360) * WORLD_PX;
}

/** Latitude → world-y pixel at zoom 0 (Web-Mercator; north = smaller y). */
function latToWorldY(lat: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  // Clamp the mercator term like Google does so ±90° stays finite.
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return Math.min(Math.max(y, 0), 1) * WORLD_PX;
}

/** Inverse of {@link latToWorldY}. */
function worldYToLat(y: number): number {
  const n = Math.PI - (2 * Math.PI * y) / WORLD_PX;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** Inverse of {@link lngToWorldX}. */
function worldXToLng(x: number): number {
  return (x / WORLD_PX) * 360 - 180;
}

/**
 * The `{ center, zoom }` camera that fits `bounds` inside a map viewport of
 * `size` pixels, keeping `padding` pixels clear on each side — the same fit
 * `map.fitBounds(bounds, padding)` performs, but as a pure value usable with
 * the never-animated `map.moveCamera(...)` (reduced-motion path).
 *
 * Asymmetric padding shifts the returned center so the bounds sit centred in
 * the REMAINING content box (e.g. the directory map pads the bottom heavily so
 * pins clear the opaque carousel band).
 */
export function cameraForBounds(
  bounds: MapBounds,
  size: { width: number; height: number },
  padding: MapPadding
): { center: { lat: number; lng: number }; zoom: number } {
  const west = lngToWorldX(bounds.west);
  const east = lngToWorldX(bounds.east);
  const top = latToWorldY(bounds.north);
  const bottom = latToWorldY(bounds.south);
  const worldW = Math.max(east - west, 1e-9);
  const worldH = Math.max(bottom - top, 1e-9);

  // The content box the bounds must fit into, after padding (≥ 1px so a tiny
  // viewport can't produce a negative/zero box and a NaN zoom).
  const effWidth = Math.max(size.width - padding.left - padding.right, 1);
  const effHeight = Math.max(size.height - padding.top - padding.bottom, 1);

  const zoom = Math.min(
    Math.max(Math.log2(Math.min(effWidth / worldW, effHeight / worldH)), MIN_ZOOM),
    MAX_ZOOM
  );
  const scale = 2 ** zoom;

  // Center of the padded content box in viewport pixels vs. the viewport's own
  // center: the difference (converted to world units at this zoom) is how far
  // the CAMERA center must shift so the bounds land centred in the content box.
  const offsetX = (size.width / 2 - (padding.left + effWidth / 2)) / scale;
  const offsetY = (size.height / 2 - (padding.top + effHeight / 2)) / scale;

  return {
    center: {
      lat: worldYToLat((top + bottom) / 2 + offsetY),
      lng: worldXToLng((west + east) / 2 + offsetX),
    },
    zoom,
  };
}
