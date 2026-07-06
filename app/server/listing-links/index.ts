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
 * Typed listing links — the db-touching READ + WRITE implementations (AUB-202).
 *
 * A listing carries at most one link per kind (`LINK_KINDS`), stored in
 * `listing_links` with a UNIQUE(listing_id, kind) constraint. Writes are
 * WIKI-STYLE by deliberate product decision: ANY signed-in user may save or
 * remove any listing's links (no ownership check — do not add one), moderated
 * like other content. `createdBy` is provenance for moderation/abuse
 * investigation only, never an authorization key.
 *
 * LEGACY `listings.menu_url` (pre-AUB-202 rows): intake stopped writing it, so
 * it lingers only on old rows. The rule is **typed menu writes supersede it**:
 * any `menu`-kind save or remove ALSO clears the legacy column, so a removed
 * menu link stays removed (the detail page's render fallback would otherwise
 * resurrect the legacy URL) and an edited menu link never has a stale legacy
 * twin. {@link listListingLinks} returns the legacy value alongside the typed
 * rows, so the ONE invalidated query refreshes both after an edit.
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

/** What the per-listing links read returns: typed rows + the legacy fallback. */
export interface ListingLinksResult {
  /** The typed rows, in `LINK_KINDS` order. */
  links: ListingLink[];
  /**
   * The listing's legacy `menu_url` column (pre-AUB-202 rows the backfill
   * hasn't reached). The render sink treats it as the menu link ONLY when no
   * `menu`-kind row exists, and guards it with `isHttpUrl` (#90). `null` once
   * a typed menu write has superseded it.
   */
  legacyMenuUrl: string | null;
}

/**
 * Resolve the target listing's visible row (or `null`). Public reads must
 * treat a moderator-hidden/removed listing exactly like a missing one (#41):
 * accepting a write (or serving its links) would leak that the row exists (a
 * moderation-state oracle) and let content accrue on a listing the public
 * cannot see.
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
 * Null out the legacy `menu_url` column — a typed `menu`-kind write supersedes
 * it (see the module doc). Scoped to rows still carrying a value so the
 * common case (already-migrated listing) writes nothing.
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
 * fallback. `kind` is a Postgres enum, and an enum column sorts by its
 * DECLARATION order — which is exactly the client-safe `LINK_KINDS` tuple
 * order (the pgEnum derives from it) — so `ORDER BY kind` yields the
 * deterministic display order with no app-side sort. Open and unmetered —
 * reads stay anonymous (domain.md, "Read is open").
 *
 * Parent visibility (#41): `moderationStatus` has no parent→child propagation
 * and links carry no moderation state of their own, so this addressable
 * per-listing RPC first resolves the VISIBLE parent listing and returns the
 * empty result when it is missing or moderated away — a hidden/removed
 * listing leaks neither its typed links nor its legacy menu URL (same reason
 * `listIncidents` re-checks parent visibility).
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
 * Save a listing's link for one kind — an UPSERT on the (listing, kind) unique
 * constraint: inserts when the kind has no link yet, otherwise updates the
 * existing row's `url` (bumping `updatedAt`). `createdBy` is set only on
 * insert — an edit never rewrites the original provenance. A `menu`-kind save
 * ALSO clears the legacy `menu_url` column (typed writes supersede it), so an
 * old row never keeps a stale legacy twin of its typed menu link.
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
 * Deleting a kind that has no typed row is a NO-OP SUCCESS: the caller's
 * intent ("this kind should have no link") already holds, and the delete is
 * idempotent — mirroring how `onConflictDoNothing` writes treat an
 * already-satisfied state.
 *
 * A `menu`-kind remove ALSO clears the legacy `menu_url` column. Without
 * this, removing the menu link on a pre-AUB-202 row would silently resurrect
 * the legacy URL through the render fallback (delete the typed row → the
 * fallback shows `menu_url` again) — and a legacy-only row would have NO way
 * to lose its menu link at all, since nothing else writes that column.
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
