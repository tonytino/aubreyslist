/**
 * Pure lat/lng → map-percentage projection for the stylized directory map
 * (AUB-61, Phase 2b). The real map provider (Mapbox / Google) is deferred to
 * AUB-111; until then the map is a CSS backdrop, and each listing's REAL stored
 * `lat`/`lng` is projected into the backdrop with a FIXED metro-Denver bounding
 * box so pins land in believable relative positions (north-west spots up-left,
 * etc.) rather than being faked with hard-coded coordinates.
 *
 * CLIENT-SAFE + PURE: no `db`/server import, no React — just arithmetic, so it is
 * trivially unit-testable and safe in the browse client bundle.
 */

/**
 * A generous bounding box around metro Denver (roughly Boulder/Broomfield in the
 * north-west down to Highlands Ranch / Aurora in the south-east). Chosen wide so
 * the pilot's listings sit comfortably INSIDE the box; anything outside is
 * clamped to the edges rather than projected off-screen.
 */
export const DENVER_BBOX = {
  minLat: 39.55,
  maxLat: 39.95,
  minLng: -105.15,
  maxLng: -104.75,
} as const;

/** Clamp to the inclusive [0, 100] percentage range. */
function clampPct(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

/**
 * Project a listing's real `lat`/`lng` to `{ left, top }` percentages within the
 * map backdrop.
 *
 * - `left` grows west → east with longitude (min longitude = left edge).
 * - `top` grows north → south: higher latitude (further north) maps to a SMALLER
 *   `top` (nearer the top of the screen), matching how a north-up map reads.
 *
 * Non-finite coordinates (missing/garbage data) fall back to the map centre so a
 * pin never disappears or throws — the map degrades honestly rather than hiding
 * a restaurant entirely.
 */
export function projectToMap(lat: number, lng: number): { left: number; top: number } {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { left: 50, top: 50 };
  }
  const { minLat, maxLat, minLng, maxLng } = DENVER_BBOX;
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;
  const left = clampPct(((lng - minLng) / lngSpan) * 100);
  // Invert latitude so north (higher lat) is nearer the top (smaller `top`).
  const top = clampPct(((maxLat - lat) / latSpan) * 100);
  return { left, top };
}
