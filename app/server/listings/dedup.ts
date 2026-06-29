import type { Listing } from "~/db/schema";

/**
 * The duplicate-listing error contract — the `DuplicateListingError` marker class
 * and the client-side `parseDuplicateListingError` parser — lives in the
 * client-safe `app/listings/dedup-error.ts` (issue #141), so the add-listing
 * intake forms can render the blocked-duplicate link WITHOUT value-importing this
 * db-touching server module. It is re-exported here so server code (`create.ts`)
 * and the existing dedup tests keep a single import surface.
 */
export { DuplicateListingError, parseDuplicateListingError } from "~/listings/dedup-error";

/**
 * Manual-entry duplicate-listing safeguard (issue #25, ADR-008).
 *
 * Places-mode entries dedup on the canonical Google Place ID (a DB-level UNIQUE
 * constraint on `listings.place_id`; resolved gracefully in `create.ts`). Manual
 * entries carry `placeId: null`, which Postgres treats as distinct, so the unique
 * index never collides them — leaving the door open for two people to free-type
 * the same restaurant. This module closes that door with a deterministic
 * normalized name+address match, kept out of `create.ts` so the matching rule is
 * unit-testable in isolation and reusable.
 *
 * Why JS comparison (not pg_trgm / a generated column): adding a fuzzy-match
 * extension or a normalized column is a schema/infra change (`safe:human`) for a
 * low-volume intake path. A normalized exact match on name+address is simple,
 * deterministic, and trivially testable. The candidate query (`create.ts`,
 * `assertNoManualDuplicate`) loads the **visible manual** subset (`place_id IS
 * NULL AND moderation_status = 'visible'`) and the match is decided in JS — it is
 * bounded by the manual-listing count, not a true SQL prefilter on the normalized
 * key (replicating `normalizeForDedup`'s NFKD diacritic fold in SQL would need
 * `unaccent`, a DB extension we deliberately don't add).
 *
 * Known limitations (acceptable for v1, not bugs):
 * - **Residual TOCTOU:** there is no DB unique constraint on normalized
 *   name+address (by design — addresses are free-form and not reliably unique),
 *   so the check is read-then-write with no lock. Two concurrent identical manual
 *   submissions can both pass and both insert (both `placeId = NULL`, distinct to
 *   Postgres). This is strictly weaker than the Places path, whose
 *   `place_id`-UNIQUE makes its dedup race-safe at the DB. Such a slipped-through
 *   manual dup is moderatable after the fact (#41), which is the intended backstop.
 * - **False-negatives not handled in v1:** abbreviation variants (`St.`/`Street`,
 *   `&`/`and`) and omitted suite/unit numbers will read as distinct and won't be
 *   caught.
 */

/**
 * Normalize a free-typed name/address for duplicate comparison. The transform is
 * intentionally lossy and order-fixed so it is deterministic:
 *
 * 1. Unicode NFKD decompose, then strip combining marks → diacritics fold
 *    (`Café` → `cafe`, `Peña` → `pena`).
 * 2. Lowercase.
 * 3. Replace every run of non-alphanumeric characters with a single space →
 *    punctuation/symbols (`,`, `.`, `&`, `#`, `-`, `'`) collapse to a separator,
 *    so `"Joe's Diner #2"` and `"Joes Diner 2"` match.
 * 4. Trim and collapse whitespace.
 *
 * The result is `""` only for input that is empty or punctuation-only.
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
 * Decide whether a proposed manual entry is a likely duplicate of an existing
 * listing. The rule is a **strong, deterministic match**: the normalized name
 * AND the normalized address must both be equal. This blocks the same restaurant
 * free-typed twice (case / punctuation / accent / spacing differences and all),
 * while a different name OR a different address is treated as distinct (no
 * false-positive on two unrelated places, or two branches of a chain at
 * different addresses).
 *
 * Returns the first matching existing listing, or `null` when none match.
 */
export function findDuplicateListing(
  candidate: { name: string; address: string },
  existing: readonly Listing[]
): Listing | null {
  const name = normalizeForDedup(candidate.name);
  const address = normalizeForDedup(candidate.address);
  // A blank normalized name/address can't meaningfully dedup (and shouldn't reach
  // here — the schema requires non-empty name/address).
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
