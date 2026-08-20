import type { Listing } from "~/db/schema";

/**
 * The duplicate-listing error contract lives in the client-safe
 * `app/listings/dedup-error.ts`, so the intake forms can render the
 * blocked-duplicate link without value-importing this db-touching server
 * module. Re-exported here so server code and the dedup tests keep a single
 * import surface.
 */
export { DuplicateListingError, parseDuplicateListingError } from "~/listings/dedup-error";

/**
 * Manual-entry duplicate-listing safeguard (ADR-008).
 *
 * Places-mode entries dedup on the Google Place ID (a unique index on
 * `listings.place_id`, resolved gracefully in `create.ts`). Manual entries
 * carry `placeId: null`, which Postgres treats as distinct, so the unique
 * index never collides them — two people could free-type the same
 * restaurant. This module closes that gap with a deterministic normalized
 * name+address match, kept out of `create.ts` so the rule is unit-testable in
 * isolation and reusable.
 *
 * Why JS comparison, not pg_trgm or a generated column: a fuzzy-match
 * extension or normalized column is a schema/infra change (`safe:human`) for
 * a low-volume intake path, and replicating `normalizeForDedup`'s NFKD
 * diacritic fold in SQL would need `unaccent`, an extension we deliberately
 * don't add. The candidate query loads the visible manual subset
 * (`place_id is null and moderation_status = 'visible'`) and the match runs
 * in JS, bounded by the manual-listing count.
 *
 * Known limitations (accepted for v1, not bugs):
 * - Residual TOCTOU: no DB unique on normalized name+address (addresses are
 *   free-form and not reliably unique), so the check is read-then-write with
 *   no lock. Two concurrent identical manual submissions can both insert;
 *   moderation is the intended backstop. The Places path is race-safe at the
 *   DB via its unique `place_id`.
 * - Abbreviation variants (`St.`/`Street`, `&`/`and`) and omitted suite/unit
 *   numbers read as distinct and are not caught.
 */

/**
 * Normalize a free-typed name/address for duplicate comparison. Intentionally
 * lossy and order-fixed, so it is deterministic:
 *
 * 1. Unicode NFKD decompose, then strip combining marks (diacritics fold:
 *    `Café` → `cafe`, `Peña` → `pena`).
 * 2. Lowercase.
 * 3. Replace each run of non-alphanumerics with a single space, so
 *    `"Joe's Diner #2"` and `"Joes Diner 2"` match.
 * 4. Trim and collapse whitespace.
 *
 * The result is `""` only for empty or punctuation-only input.
 */
export function normalizeForDedup(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // strip combining marks left by NFKD (diacritics fold)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ") // punctuation/symbols → single space
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Decide whether a proposed manual entry duplicates an existing listing. The
 * rule is a strong, deterministic match: normalized name and normalized
 * address must both be equal. This blocks the same restaurant free-typed
 * twice (across case/punctuation/accent/spacing noise), while a different
 * name or address — e.g. two branches of a chain — stays distinct.
 *
 * Returns the first matching existing listing, or `null` when none match.
 */
export function findDuplicateListing(
  candidate: { name: string; address: string },
  existing: readonly Listing[]
): Listing | null {
  const name = normalizeForDedup(candidate.name);
  const address = normalizeForDedup(candidate.address);
  // A blank normalized name/address can't meaningfully dedup (the schema
  // requires non-empty name/address anyway).
  if (name === "" || address === "") {
    return null;
  }

  for (const listing of existing) {
    if (
      normalizeForDedup(listing.name) === name &&
      normalizeForDedup(listing.address) === address
    ) {
      return listing;
    }
  }
  return null;
}
