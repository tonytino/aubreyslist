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

/**
 * Machine-readable marker appended to {@link DuplicateListingError.message}. The
 * structured `existingListing*` fields below are authoritative server-side and in
 * tests, but TanStack Start serializes a thrown error across the server-fn RPC
 * boundary down to a plain `Error` — custom subclass fields do NOT survive to the
 * client. So the existing-listing id is also embedded in the message via this
 * marker, and {@link parseDuplicateListingError} re-extracts it client-side to
 * build a link. The marker is intentionally terse and id-only (the name is
 * already human-readable in the leading sentence) and is stripped from the
 * displayed text by the parser.
 */
const DUPLICATE_MARKER_PREFIX = "[[existing-listing:";
const DUPLICATE_MARKER_SUFFIX = "]]";

/**
 * Thrown when a manual-entry submission is blocked as a likely duplicate. Carries
 * the existing listing's id and name as structured fields (authoritative
 * server-side) AND embeds the id in `message` via a marker so the client — which
 * only receives `error.message` across the RPC boundary — can still link to the
 * listing that already exists (see {@link parseDuplicateListingError}).
 */
export class DuplicateListingError extends Error {
  readonly existingListingId: string;
  readonly existingListingName: string;

  constructor(existing: Pick<Listing, "id" | "name">) {
    super(
      `"${existing.name}" is already listed at this address. Open the existing listing instead of adding a duplicate. ` +
        `${DUPLICATE_MARKER_PREFIX}${existing.id}${DUPLICATE_MARKER_SUFFIX}`
    );
    this.name = "DuplicateListingError";
    this.existingListingId = existing.id;
    this.existingListingName = existing.name;
  }
}

/**
 * Client-safe parse of an arbitrary error into the structured duplicate-listing
 * shape, recovering the existing listing's id from the message marker that
 * survives the server-fn RPC boundary (custom error fields do not). Returns the
 * human-readable message with the marker stripped, plus `existingListingId` when
 * present so the UI can render a link.
 *
 * Returns `null` for any error that is not a blocked-duplicate error, so callers
 * fall back to their generic error rendering.
 */
export function parseDuplicateListingError(
  error: unknown
): { message: string; existingListingId: string | null } | null {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const start = message.indexOf(DUPLICATE_MARKER_PREFIX);
  if (start === -1) {
    return null;
  }
  const idStart = start + DUPLICATE_MARKER_PREFIX.length;
  const end = message.indexOf(DUPLICATE_MARKER_SUFFIX, idStart);
  if (end === -1) {
    return null;
  }
  const existingListingId = message.slice(idStart, end).trim() || null;
  const displayMessage = message.slice(0, start).trim();
  return { message: displayMessage, existingListingId };
}
