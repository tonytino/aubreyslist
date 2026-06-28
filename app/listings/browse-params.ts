/**
 * Browse URL-param helpers + page-size constants — the client-safe shared module
 * for the `/listings` browse route (issues #33–#37).
 *
 * CLIENT-SAFE: pure data + tiny parsers/serializers. Imports NO database client
 * and NO server-only code (only the `claimAttributes` enum from the schema, a
 * plain readonly tuple), mirroring `app/listings/sort.ts` and
 * `app/listings/distance.ts`. So the browse route's search-param handling (client
 * bundle) and the browse server validator (server) share ONE definition of how
 * `?attrs=`/`?lat=`/`?lng=` are parsed and how the page is sized. Keep it free of
 * any `db` client / server-only imports.
 */

import { type ClaimAttribute, claimAttributes } from "~/db/schema";

/** Default page size for the browse list. */
export const BROWSE_PAGE_SIZE = 20;
/** Max page size accepted by the browse server validator (clamps `pageSize`). */
export const MAX_PAGE_SIZE = 50;

/**
 * Parse the `?attrs=` string into a de-duplicated list of valid taxonomy
 * attributes. The param is a COMMA-SEPARATED list (e.g.
 * `?attrs=dedicated_fryer,celiac_safe_vs_gluten_friendly`) — shareable and
 * human-readable, mirroring `?page=`. Unknown/garbage values are dropped (not an
 * error) so a hand-edited URL degrades gracefully to the valid subset.
 *
 * Kept as a single STRING in the URL (rather than a router-serialized array) so
 * the encoding stays the clean comma form and not URL-encoded JSON.
 */
export function parseAttrs(value: string): ClaimAttribute[] {
  const valid = new Set<ClaimAttribute>();
  for (const part of value.split(",")) {
    const token = part.trim();
    if ((claimAttributes as readonly string[]).includes(token)) {
      valid.add(token as ClaimAttribute);
    }
  }
  return [...valid];
}

/** Serialize a selection back to the canonical comma-separated `?attrs=` value. */
export function serializeAttrs(attrs: readonly ClaimAttribute[]): string {
  return attrs.join(",");
}

/** A complete user coordinate pair, or undefined when only a partial/none is set. */
export interface UserCoords {
  lat: number;
  lng: number;
}

/** Build a complete coord pair from the search params, or undefined if incomplete. */
export function coordsFromSearch(
  lat: number | undefined,
  lng: number | undefined
): UserCoords | undefined {
  return lat !== undefined && lng !== undefined ? { lat, lng } : undefined;
}
