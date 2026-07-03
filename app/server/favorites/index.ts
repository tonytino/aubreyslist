import { and, count, desc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getDb } from "~/db/client";
import { favorites, listings } from "~/db/schema";
import type { FavoriteInput } from "~/listings/favorite-input";
import { getCurrentUser } from "~/server/auth/current-user";
import { requireCurrentUser } from "~/server/auth/guards";
import { type BrowseListingCard, buildBrowseCards } from "~/server/listings/browse";
import { enforceWriteLimit } from "~/server/rate-limit";

/**
 * Favorites (bookmarks) — the WRITE + READ layer (issue AUB-120 / F2).
 *
 * A signed-in user favorites a listing (one row) and unfavorites by deleting it
 * — the row is never mutated (domain.md; `favorites` schema). One favorite per
 * user per listing is enforced at the DB level by the
 * `favorites_user_listing_unique` constraint on (`user_id`, `listing_id`), which
 * makes {@link addFavorite} idempotent and concurrent-safe via
 * `onConflictDoNothing`.
 *
 * Server-only: imports the DB client, the auth guards, and the current-user
 * accessor. Never import this from client code — the client calls the
 * `createServerFn` wrappers in `./favorites.fn.ts` (the `*.fn.ts` convention),
 * which the TanStack Start plugin strips from the browser bundle so `getDb`
 * (neon/drizzle) never leaks client-side.
 *
 * Open-read / gated-write (ADR-010): the writes ({@link addFavorite},
 * {@link removeFavorite}) are login-gated via {@link requireCurrentUser} (401 for
 * anonymous) and then rate-limited per user via {@link enforceWriteLimit} (#18;
 * 429 on an abusive burst), applied in that order and BEFORE any DB work — the
 * gate fires exactly once. The viewer read ({@link getViewerFavoriteIds}) is
 * scoped to the current user (empty for anonymous, with no DB hit); the count
 * aggregate ({@link getFavoriteCounts}) is public and user-agnostic.
 */

/**
 * Favorite a listing for the current user (idempotent, concurrent-safe).
 *
 * Login-gated then rate-limited (in that order, before any DB work). The target
 * listing must EXIST and be `visible`: a hidden/removed or non-existent listing
 * must not be favoritable, so we resolve its `moderationStatus` first and throw
 * `404 Not Found` (matching how the codebase surfaces not-found, e.g.
 * `admin/set-role.ts`) for any non-`visible` or missing listing — never
 * inserting a favorite for content the user cannot see.
 *
 * The insert is `onConflictDoNothing` on `favorites_user_listing_unique`, so a
 * repeated favorite (or a concurrent double-add) is a no-op rather than a
 * duplicate or an error — one row per (user, listing).
 */
export async function addFavorite(input: FavoriteInput): Promise<void> {
  const user = await requireCurrentUser();
  await enforceWriteLimit(user.id);

  const db = getDb();

  // Resolve the listing's visibility first: a hidden/removed or missing listing
  // must not be favoritable (404), never leaking a favorite on unseen content.
  const rows = await db
    .select({ moderationStatus: listings.moderationStatus })
    .from(listings)
    .where(eq(listings.id, input.listingId))
    .limit(1);

  const listing = rows[0];
  if (!listing || listing.moderationStatus !== "visible") {
    throw new HTTPException(404, { message: "Listing not found." });
  }

  await db
    .insert(favorites)
    .values({ userId: user.id, listingId: input.listingId })
    .onConflictDoNothing({ target: [favorites.userId, favorites.listingId] });
}

/**
 * Unfavorite a listing for the current user — deletes their `favorites` row for
 * the listing.
 *
 * Login-gated then rate-limited (in that order, before any DB work). A no-op
 * when no favorite exists for the (user, listing) pair (the delete simply
 * matches zero rows) — no visibility check is needed to REMOVE a bookmark.
 */
export async function removeFavorite(input: FavoriteInput): Promise<void> {
  const user = await requireCurrentUser();
  await enforceWriteLimit(user.id);

  const db = getDb();

  await db
    .delete(favorites)
    .where(and(eq(favorites.userId, user.id), eq(favorites.listingId, input.listingId)));
}

/**
 * The current viewer's favorited listing ids, filtered to listings that are
 * still `visible`.
 *
 * Anonymous callers have no favorites: we return `[]` WITHOUT touching the DB
 * (reads stay open, and there is nothing to look up). For a signed-in user we
 * INNER JOIN `listings` and filter to `moderationStatus = "visible"`, so a
 * favorite whose listing was later hidden/removed by a moderator is excluded —
 * the viewer never sees ids for content that is no longer visible.
 */
export async function getViewerFavoriteIds(): Promise<string[]> {
  const user = await getCurrentUser();
  if (!user) {
    return [];
  }

  const db = getDb();

  const rows = await db
    .select({ listingId: favorites.listingId })
    .from(favorites)
    .innerJoin(listings, eq(listings.id, favorites.listingId))
    .where(and(eq(favorites.userId, user.id), eq(listings.moderationStatus, "visible")));

  return rows.map((row) => row.listingId);
}

/**
 * The current viewer's favorited listings as ready-to-render browse cards (issue
 * AUB-127 / F9) — the data behind the `/favorites` page.
 *
 * Anonymous callers have no favorites: we return `[]` WITHOUT touching the DB
 * (reads stay open, nothing to look up). For a signed-in user we INNER JOIN
 * `listings` and filter to `moderationStatus = "visible"` (so a favorite whose
 * listing was later hidden/removed is excluded), ordered by `favorites.createdAt
 * DESC` — most-recently-saved first.
 *
 * The resulting listings run through the SHARED, distance-agnostic
 * {@link buildBrowseCards} so each card's trust glance is byte-identical to the
 * browse page (same celiac aggregate + recent-incident derivation). We then
 * attach the public save-count aggregate ({@link getFavoriteCounts}) for those
 * ids — batched alongside the glance (NO N+1) — so the save-count pill renders on
 * `/favorites` exactly as it does on browse. No distance is computed (favorites
 * have no distance origin), so `distanceLabel` stays absent.
 *
 * v1 loads the FULL favorite set unbounded — favorites lists are small.
 *
 * SERVER-ONLY: drives the db client + `buildBrowseCards`; the route/query reach it
 * only through the client-safe `favorites.fn` seam.
 */
export async function getViewerFavorites(
  now: Date,
  stalenessMonths: number
): Promise<BrowseListingCard[]> {
  const user = await getCurrentUser();
  if (!user) {
    return [];
  }

  const db = getDb();

  // The viewer's favorited listings, visibility-gated and newest-saved first.
  const rows = await db
    .select({ listing: listings })
    .from(favorites)
    .innerJoin(listings, eq(listings.id, favorites.listingId))
    .where(and(eq(favorites.userId, user.id), eq(listings.moderationStatus, "visible")))
    .orderBy(desc(favorites.createdAt));

  const viewerListings = rows.map((row) => row.listing);
  const listingIds = viewerListings.map((listing) => listing.id);

  // Build the trust cores through the SAME helper the browse page uses (so the
  // glance matches byte-for-byte), and batch the public save-counts alongside it
  // (one grouped query, NO N+1) — mirroring how getBrowseListings assembles a card.
  const [baseCards, favoriteCounts] = await Promise.all([
    buildBrowseCards(viewerListings, now, stalenessMonths),
    getFavoriteCounts(listingIds),
  ]);

  // Attach the save-count (defaulting to 0 for a listing absent from the grouped
  // aggregate). No distance origin here, so `distanceLabel` is intentionally absent.
  return baseCards.map((card) => ({
    ...card,
    favoriteCount: favoriteCounts.get(card.listing.id) ?? 0,
  }));
}

/**
 * Public, user-agnostic favorite counts for the given listing ids: a grouped
 * `count(*)` over `favorites`.
 *
 * Empty input yields an empty map WITHOUT a DB hit. The returned map contains
 * only listings that have at least one favorite (a listing with none is simply
 * absent — callers default it to 0), keyed by listing id.
 */
export async function getFavoriteCounts(listingIds: string[]): Promise<Map<string, number>> {
  if (listingIds.length === 0) {
    return new Map();
  }

  const db = getDb();

  const rows = await db
    .select({ listingId: favorites.listingId, n: count() })
    .from(favorites)
    .where(inArray(favorites.listingId, listingIds))
    .groupBy(favorites.listingId);

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.listingId, row.n);
  }
  return counts;
}

// The client-callable `createServerFn` wrappers (favoriteListing /
// unfavoriteListing / fetchViewerFavoriteIds) live in `./favorites.fn.ts` (the
// `*.fn.ts` convention), so client code never imports this db-touching module —
// see the module docstring above.
