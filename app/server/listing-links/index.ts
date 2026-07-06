import { and, asc, eq, getTableColumns } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getDb } from "~/db/client";
import { type ListingLink, listingLinks, listings } from "~/db/schema";
import type {
  ListListingLinksInput,
  RemoveListingLinkInput,
  SaveListingLinkInput,
} from "~/listings/links";
import { requireCurrentUser } from "~/server/auth/guards";
import { enforceWriteLimit } from "~/server/rate-limit";

/**
 * Typed listing links — the db-touching READ + WRITE implementations (AUB-202).
 *
 * A listing carries at most one link per kind (`LINK_KINDS`), stored in
 * `listing_links` with a UNIQUE(listing_id, kind) constraint. Writes are
 * WIKI-STYLE by deliberate product decision: ANY signed-in user may save or
 * remove any listing's links (no ownership check — do not add one), moderated
 * like other content. `createdBy` is provenance for moderation/abuse
 * investigation only, never an authorization key.
 *
 * Server-only: imports the DB client and the auth guards. NEVER import this
 * module from client code — it transitively pulls in `getDb` (neon/drizzle).
 * The split that keeps the client build clean (the incidents-module pattern):
 *
 * - **Client-callable server functions** ({@link fetchListingLinks} et al.)
 *   live in `./links.fn.ts` (the `*.fn.ts` convention); the plugin strips
 *   their handler bodies out of the browser bundle.
 * - **Pure, client-safe pieces** (the `LINK_KINDS` taxonomy, display metadata,
 *   Zod schemas) live in `app/listings/links.ts`.
 *
 * Writes are login-gated via {@link requireCurrentUser} (401 for anonymous
 * callers), then rate-limited per user via {@link enforceWriteLimit} (#18;
 * 429 on an abusive burst), then the target listing is verified to exist AND
 * be `visible` (404 otherwise — the same order `createListing`/`reportIncident`
 * use). Reads ({@link listListingLinks}) are open and unmetered.
 */

/**
 * Assert the target listing exists and is publicly `visible`; 404 otherwise.
 *
 * Visibility matters (#41): a moderator-hidden/removed listing 404s on every
 * public read, so its links must not be writable either — accepting a write
 * would both leak that the row exists (a moderation-state oracle) and let
 * content accrue on a listing the public cannot see.
 */
async function assertVisibleListing(listingId: string): Promise<void> {
  const listing = await getDb().query.listings.findFirst({
    where: and(eq(listings.id, listingId), eq(listings.moderationStatus, "visible")),
  });
  if (!listing) {
    throw new HTTPException(404, { message: "Listing not found." });
  }
}

// ---------------------------------------------------------------------------
// Read — a listing's typed links, in LINK_KINDS order
// ---------------------------------------------------------------------------

/**
 * List a listing's typed links ordered by kind. `kind` is a Postgres enum, and
 * an enum column sorts by its DECLARATION order — which is exactly the
 * client-safe `LINK_KINDS` tuple order (the pgEnum derives from it) — so
 * `ORDER BY kind` yields the deterministic display order with no app-side sort.
 * Open and unmetered — reads stay anonymous (domain.md, "Read is open").
 *
 * Parent visibility (#41): `moderationStatus` has no parent→child propagation
 * and links carry no moderation state of their own, so this addressable
 * per-listing RPC INNER JOINs `listings` and requires the parent listing to be
 * `visible` — a moderated-away listing leaks no links (same reason
 * `listIncidents` re-checks parent visibility).
 */
export async function listListingLinks(input: ListListingLinksInput): Promise<ListingLink[]> {
  return (
    getDb()
      // Project only the link columns: the join to `listings` is a visibility
      // gate, not data we return, so the row shape stays a flat `ListingLink`.
      .select(getTableColumns(listingLinks))
      .from(listingLinks)
      .innerJoin(listings, eq(listings.id, listingLinks.listingId))
      .where(
        and(eq(listingLinks.listingId, input.listingId), eq(listings.moderationStatus, "visible"))
      )
      .orderBy(asc(listingLinks.kind))
  );
}

// ---------------------------------------------------------------------------
// Write — save (upsert by kind) a link (login-gated, rate-limited)
// ---------------------------------------------------------------------------

/**
 * Save a listing's link for one kind — an UPSERT on the (listing, kind) unique
 * constraint: inserts when the kind has no link yet, otherwise updates the
 * existing row's `url` (bumping `updatedAt`). `createdBy` is set only on
 * insert — an edit never rewrites the original provenance.
 *
 * Gates, in the standard order: {@link requireCurrentUser} (401) →
 * {@link enforceWriteLimit} (429) → visible-listing check (404) → write.
 * Wiki-style authz: any signed-in user may save (AUB-202) — no ownership check.
 */
export async function saveListingLink(input: SaveListingLinkInput): Promise<ListingLink> {
  const user = await requireCurrentUser();
  await enforceWriteLimit(user.id);
  await assertVisibleListing(input.listingId);

  const upserted = await getDb()
    .insert(listingLinks)
    .values({
      listingId: input.listingId,
      kind: input.kind,
      url: input.url,
      createdBy: user.id,
    })
    .onConflictDoUpdate({
      target: [listingLinks.listingId, listingLinks.kind],
      // `createdBy` is deliberately NOT in the update set: the original
      // contributor stays recorded when someone else edits the URL.
      set: { url: input.url, updatedAt: new Date() },
    })
    .returning();

  // A single-row upsert always returns exactly one row; narrow off `undefined`.
  const row = upserted[0];
  if (!row) {
    throw new Error("Listing link save returned no row.");
  }
  return row;
}

// ---------------------------------------------------------------------------
// Write — remove a link (login-gated, rate-limited)
// ---------------------------------------------------------------------------

/**
 * Remove a listing's link for one kind. Same gates as {@link saveListingLink}.
 * Deleting a kind that has no link is a NO-OP SUCCESS: the caller's intent
 * ("this kind should have no link") already holds, and the delete is idempotent
 * — mirroring how `onConflictDoNothing` writes treat an already-satisfied state.
 */
export async function removeListingLink(input: RemoveListingLinkInput): Promise<void> {
  const user = await requireCurrentUser();
  await enforceWriteLimit(user.id);
  await assertVisibleListing(input.listingId);

  await getDb()
    .delete(listingLinks)
    .where(and(eq(listingLinks.listingId, input.listingId), eq(listingLinks.kind, input.kind)));
}
