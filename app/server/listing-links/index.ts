import { and, asc, eq, isNotNull } from "drizzle-orm";
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
 * Typed listing links — the db-touching read + write implementations.
 *
 * A listing carries at most one link per kind (`LINK_KINDS`), stored in
 * `listing_links` with a UNIQUE(listing_id, kind) constraint. Writes are
 * wiki-style by deliberate product decision: any signed-in user may save or
 * remove any listing's links (no ownership check — do not add one), moderated
 * like other content. `createdBy` is provenance for moderation/abuse
 * investigation only, never an authorization key.
 *
 * Typed menu writes supersede the legacy `listings.menu_url` column, which
 * survives only on old rows: any `menu`-kind save or remove also clears it,
 * so a removed menu link stays removed (the detail page's render fallback
 * would otherwise resurrect the legacy URL) and an edited menu link never has
 * a stale legacy twin. {@link listListingLinks} returns the legacy value
 * alongside the typed rows, so one invalidated query refreshes both.
 *
 * Server-only: imports the DB client and the auth guards. Never import this
 * module from client code — it transitively pulls in `getDb` (neon/drizzle).
 * Client-callable server functions live in `./links.fn.ts`; the pure
 * client-safe pieces (the `LINK_KINDS` taxonomy, display metadata, Zod
 * schemas) live in `app/listings/links.ts`.
 *
 * Write gates, in order: {@link requireCurrentUser} (401), then
 * {@link enforceWriteLimit} per user (429), then a visible-listing check
 * (404). Reads ({@link listListingLinks}) are open and unmetered.
 */

/** What the per-listing links read returns: typed rows + the legacy fallback. */
export interface ListingLinksResult {
  /** The typed rows, in `LINK_KINDS` order. */
  links: ListingLink[];
  /**
   * The listing's legacy `menu_url` column. The render sink treats it as the
   * menu link only when no `menu`-kind row exists, guarded by `isHttpUrl`.
   * `null` once a typed menu write has superseded it.
   */
  legacyMenuUrl: string | null;
}

/**
 * Resolve the target listing's visible row (or `null`). A moderator-hidden or
 * removed listing must behave exactly like a missing one: accepting a write
 * (or serving its links) would leak that the row exists (a moderation-state
 * oracle) and let content accrue on a listing the public cannot see.
 */
async function findVisibleListing(listingId: string): Promise<{ menuUrl: string | null } | null> {
  const listing = await getDb().query.listings.findFirst({
    where: and(eq(listings.id, listingId), eq(listings.moderationStatus, "visible")),
    columns: { menuUrl: true },
  });
  return listing ?? null;
}

/** {@link findVisibleListing}, throwing the write path's 404 when absent. */
async function assertVisibleListing(listingId: string): Promise<void> {
  if ((await findVisibleListing(listingId)) === null) {
    throw new HTTPException(404, { message: "Listing not found." });
  }
}

/**
 * Null out the legacy `menu_url` column — a typed `menu`-kind write
 * supersedes it (see the module doc). Scoped to rows still carrying a value
 * so the common case writes nothing.
 */
async function clearLegacyMenuUrl(listingId: string): Promise<void> {
  await getDb()
    .update(listings)
    .set({ menuUrl: null })
    .where(and(eq(listings.id, listingId), isNotNull(listings.menuUrl)));
}

// ---------------------------------------------------------------------------
// Read — a listing's typed links (+ legacy fallback), in LINK_KINDS order
// ---------------------------------------------------------------------------

/**
 * List a listing's typed links ordered by kind, plus the legacy `menu_url`
 * fallback. `kind` is a Postgres enum; an enum column sorts by declaration
 * order, which is exactly the `LINK_KINDS` tuple order (the pgEnum derives
 * from it), so `ORDER BY kind` yields the deterministic display order with no
 * app-side sort. Open and unmetered — reads stay anonymous (domain.md, "Read
 * is open").
 *
 * `moderationStatus` has no parent→child propagation and links carry no
 * moderation state of their own, so this addressable per-listing RPC first
 * resolves the visible parent listing and returns the empty result when it is
 * missing or moderated away — a hidden/removed listing leaks neither its
 * typed links nor its legacy menu URL.
 */
export async function listListingLinks(input: ListListingLinksInput): Promise<ListingLinksResult> {
  const listing = await findVisibleListing(input.listingId);
  if (listing === null) {
    return { links: [], legacyMenuUrl: null };
  }

  const links = await getDb()
    .select()
    .from(listingLinks)
    .where(eq(listingLinks.listingId, input.listingId))
    .orderBy(asc(listingLinks.kind));

  return { links, legacyMenuUrl: listing.menuUrl };
}

// ---------------------------------------------------------------------------
// Write — save (upsert by kind) a link (login-gated, rate-limited)
// ---------------------------------------------------------------------------

/**
 * Save a listing's link for one kind — an upsert on the (listing, kind)
 * unique constraint: inserts when the kind has no link yet, otherwise updates
 * the existing row's `url` (bumping `updatedAt`). `createdBy` is set only on
 * insert — an edit never rewrites the original provenance. A `menu`-kind save
 * also clears the legacy `menu_url` column (typed writes supersede it), so an
 * old row never keeps a stale legacy twin of its typed menu link.
 *
 * Gates, in order: {@link requireCurrentUser} (401) →
 * {@link enforceWriteLimit} (429) → visible-listing check (404) → write.
 * Wiki-style authz: any signed-in user may save — no ownership check.
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
      // `createdBy` is deliberately not in the update set: the original
      // contributor stays recorded when someone else edits the URL.
      set: { url: input.url, updatedAt: new Date() },
    })
    .returning();

  // A single-row upsert always returns exactly one row; narrow off `undefined`.
  const row = upserted[0];
  if (!row) {
    throw new Error("Listing link save returned no row.");
  }

  if (input.kind === "menu") {
    await clearLegacyMenuUrl(input.listingId);
  }
  return row;
}

// ---------------------------------------------------------------------------
// Write — remove a link (login-gated, rate-limited)
// ---------------------------------------------------------------------------

/**
 * Remove a listing's link for one kind. Same gates as {@link saveListingLink}.
 * Deleting a kind that has no typed row is a no-op success: the caller's
 * intent ("this kind should have no link") already holds, and the delete is
 * idempotent.
 *
 * A `menu`-kind remove also clears the legacy `menu_url` column. Otherwise
 * deleting the typed row would resurrect the legacy URL through the render
 * fallback — and a legacy-only row could never lose its menu link, since
 * nothing else writes that column.
 */
export async function removeListingLink(input: RemoveListingLinkInput): Promise<void> {
  const user = await requireCurrentUser();
  await enforceWriteLimit(user.id);
  await assertVisibleListing(input.listingId);

  await getDb()
    .delete(listingLinks)
    .where(and(eq(listingLinks.listingId, input.listingId), eq(listingLinks.kind, input.kind)));

  if (input.kind === "menu") {
    await clearLegacyMenuUrl(input.listingId);
  }
}
