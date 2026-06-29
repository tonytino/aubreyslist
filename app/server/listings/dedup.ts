import type { Listing } from "~/db/schema";

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
 * deterministic, and trivially testable; candidates are prefiltered in SQL by
 * normalized name (see `create.ts`) so this never scans the whole table.
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

/**
 * Thrown when a manual-entry submission is blocked as a likely duplicate. Carries
 * the existing listing's id and name as structured fields so the add-listing UI
 * can render a clear message and link the user to the listing that already
 * exists, rather than only surfacing a flat string.
 */
export class DuplicateListingError extends Error {
  readonly existingListingId: string;
  readonly existingListingName: string;

  constructor(existing: Pick<Listing, "id" | "name">) {
    super(
      `"${existing.name}" is already listed at this address. Open the existing listing instead of adding a duplicate.`
    );
    this.name = "DuplicateListingError";
    this.existingListingId = existing.id;
    this.existingListingName = existing.name;
  }
}
