/**
 * Browse URL-param helpers + page-size constants, shared so the browse route's
 * client search-param handling and the browse server validator use one
 * definition of `?attrs=` parsing and page sizing.
 *
 * Client-safe: pure data + tiny parsers. Keep it free of db-client and
 * server-only imports.
 */

import { CLAIM_ATTRIBUTES, type ClaimAttribute } from "~/listings/taxonomy";

/** Default page size for the browse list. */
export const BROWSE_PAGE_SIZE = 20;
/** Max page size accepted by the browse server validator (clamps `pageSize`). */
export const MAX_PAGE_SIZE = 50;

/**
 * Parse the `?attrs=` comma-separated string into a de-duplicated list of
 * valid taxonomy attributes. Unknown/garbage tokens are dropped, not an error,
 * so a hand-edited URL degrades to the valid subset.
 *
 * Kept a single string in the URL (not a router-serialized array) so the
 * encoding stays the clean comma form rather than URL-encoded JSON.
 */
export function parseAttrs(value: string): ClaimAttribute[] {
  const valid = new Set<ClaimAttribute>();
  for (const part of value.split(",")) {
    const token = part.trim();
    if ((CLAIM_ATTRIBUTES as readonly string[]).includes(token)) {
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
