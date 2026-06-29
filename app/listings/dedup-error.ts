/**
 * Client-safe duplicate-listing error boundary (issues #25, #141).
 *
 * CLIENT-SAFE: this module holds ONLY the pure, db-free pieces of the manual-entry
 * dedup error contract — the message marker, the {@link DuplicateListingError}
 * marker class, and the {@link parseDuplicateListingError} client parser. It
 * type-imports `Listing` (erased at build) and has NO `~/db` / drizzle / neon
 * value import, mirroring `app/listings/taxonomy.ts` (#126).
 *
 * The add-listing intake forms render the blocked-duplicate error and link to the
 * existing listing, so they import {@link parseDuplicateListingError} from HERE
 * rather than from `~/server/listings/dedup` — whose neighbouring db-touching
 * graph (`create.ts` → drizzle/neon) would otherwise be dragged into the
 * `listings.new` client chunk. The server dedup module (`dedup.ts`) re-exports
 * these so server code and existing tests keep one import surface.
 */

import type { Listing } from "~/db/schema";

/**
 * Machine-readable marker appended to {@link DuplicateListingError.message}. The
 * structured `existingListing*` fields are authoritative server-side and in
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
