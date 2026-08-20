/**
 * Client-safe pieces of the manual-entry dedup error contract: the message
 * marker, the {@link DuplicateListingError} class, and the
 * {@link parseDuplicateListingError} client parser. Type-imports `Listing`
 * (erased at build); no `~/db` / drizzle / neon value import.
 *
 * The intake forms import {@link parseDuplicateListingError} from here rather
 * than from `~/server/listings/dedup`, whose db-touching graph would drag
 * drizzle/neon into the `listings.new` client chunk. The server dedup module
 * re-exports these so server code keeps one import surface.
 */

import type { Listing } from "~/db/schema";

/**
 * Machine-readable marker appended to {@link DuplicateListingError.message}.
 * TanStack Start serializes a thrown error across the server-fn RPC boundary
 * down to a plain `Error` — custom subclass fields do not survive to the
 * client. So the existing-listing id is also embedded in the message via this
 * marker, and {@link parseDuplicateListingError} re-extracts it client-side.
 * The parser strips the marker from the displayed text.
 */
const DUPLICATE_MARKER_PREFIX = "[[existing-listing:";
const DUPLICATE_MARKER_SUFFIX = "]]";

/**
 * Thrown when a manual-entry submission is blocked as a likely duplicate.
 * Carries the existing listing's id and name as structured fields and embeds
 * the id in `message` via the marker, so the client — which only receives
 * `error.message` across the RPC boundary — can still link to the existing
 * listing.
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
 * Parse an arbitrary error into the structured duplicate-listing shape,
 * recovering the existing listing's id from the message marker. Returns the
 * message with the marker stripped, plus `existingListingId` when present.
 *
 * Returns `null` for any error that is not a blocked-duplicate error, so
 * callers fall back to their generic error rendering.
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
