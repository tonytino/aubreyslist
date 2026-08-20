import * as Sentry from "@sentry/tanstackstart-react";
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
 * Favorites (bookmarks): the write + read layer.
 *
 * A signed-in user favorites a listing (one row) and unfavorites by deleting
 * it — the row is never mutated (domain.md). One favorite per user per listing
 * is enforced by the `favorites_user_listing_unique` constraint on
 * (`user_id`, `listing_id`), which makes {@link addFavorite} idempotent and
 * concurrent-safe via `onConflictDoNothing`.
 *
 * Server-only: imports the DB client and auth guards. Never import this from
 * client code — clients call the `createServerFn` wrappers in
 * `./favorites.fn.ts`.
 *
 * Open-read / gated-write (ADR-010): writes are login-gated via
 * {@link requireCurrentUser} (401) then rate-limited per user via
 * {@link enforceWriteLimit} (429), in that order, before any DB work. The
 * viewer read ({@link getViewerFavoriteIds}) is scoped to the current user
 * (empty for anonymous, no DB hit); the count aggregate
 * ({@link getFavoriteCounts}) is public and user-agnostic.
 */

/**
 * Run a non-essential favorites read, degrading to `fallback` if it throws.
 *
 * Favorites are an enhancement over the core directory; a read failure must
 * never 500 the browse loader or the `__root` prefetch that runs on every
 * page. The realistic failure is the `favorites` table being briefly
 * unavailable (a fresh/preview DB, or a schema-release deploy window). The
 * error is reported to Sentry and logged, then the fallback renders — cards
 * simply show no save-count and no saved state.
 *
 * Only reads degrade. The gated writes still throw — a failed save must
 * surface to the user, not silently no-op.
 */
async function readOrDegrade<T>(label: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    console.error(`[favorites] ${label} failed; degrading to fallback`, error);
    Sentry.captureException(error);
    return fallback;
  }
}

/**
 * Favorite a listing for the current user. Idempotent and concurrent-safe.
 *
 * Login-gated then rate-limited, in that order, before any DB work. The
 * target listing must exist and be `visible`; any other state throws 404 —
 * never insert a favorite for content the user cannot see.
 *
 * The insert is `onConflictDoNothing` on `favorites_user_listing_unique`, so
 * a repeated or concurrent favorite is a no-op — one row per (user, listing).
 */
export async function addFavorite(input: FavoriteInput): Promise<void> {
  const user = await requireCurrentUser();
  await enforceWriteLimit(user.id);

  const db = getDb();

  // A hidden/removed or missing listing must not be favoritable (404).
  const rows = await db
    .select({ moderationStatus: listings.moderationStatus })
    .from(listings)
    .where(eq(listings.id, input.listingId))
    .limit(1);

  const listing = rows[0];
  if (listing?.moderationStatus !== "visible") {
    throw new HTTPException(404, { message: "Listing not found." });
  }

  await db
    .insert(favorites)
    .values({ userId: user.id, listingId: input.listingId })
    .onConflictDoNothing({ target: [favorites.userId, favorites.listingId] });
}

/**
 * Unfavorite a listing for the current user — deletes their `favorites` row.
 *
 * Login-gated then rate-limited, before any DB work. A no-op when no favorite
 * exists (the delete matches zero rows). Removing a bookmark needs no
 * visibility check.
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
 * The current viewer's favorited listing ids, filtered to `visible` listings.
 *
 * Anonymous callers get `[]` with no DB hit — there is nothing to look up.
 * For a signed-in user the inner join on `listings` filters to
 * `moderationStatus = "visible"`, so a favorite whose listing a moderator
 * hid or removed is excluded.
 */
export async function getViewerFavoriteIds(): Promise<string[]> {
  const user = await getCurrentUser();
  if (!user) {
    return [];
  }

  // Runs on the `__root` prefetch for every signed-in page view — degrade to
  // an empty set rather than 500 the whole app.
  return readOrDegrade("getViewerFavoriteIds", async () => {
    const db = getDb();

    const rows = await db
      .select({ listingId: favorites.listingId })
      .from(favorites)
      .innerJoin(listings, eq(listings.id, favorites.listingId))
      .where(and(eq(favorites.userId, user.id), eq(listings.moderationStatus, "visible")));

    return rows.map((row) => row.listingId);
  }, []);
}

/**
 * The current viewer's favorited listings as ready-to-render browse cards —
 * the data behind the `/favorites` page.
 *
 * Anonymous callers get `[]` with no DB hit. For a signed-in user the inner
 * join on `listings` filters to `visible`, ordered by `favorites.createdAt`
 * desc — most-recently-saved first.
 *
 * The listings run through the shared, distance-agnostic
 * {@link buildBrowseCards} so each card's trust glance matches the browse page
 * byte-for-byte, and the public save-count aggregate
 * ({@link getFavoriteCounts}) is batched alongside — no N+1. Favorites have no
 * distance origin, so `distanceLabel` stays absent.
 *
 * Loads the full favorite set unbounded — favorites lists are small.
 *
 * Server-only: drives the db client + `buildBrowseCards`; routes reach it
 * through the client-safe `favorites.fn` seam.
 */
export async function getViewerFavorites(
  now: Date,
  stalenessMonths: number
): Promise<BrowseListingCard[]> {
  const user = await getCurrentUser();
  if (!user) {
    return [];
  }

  // Degrade to an empty set (the page shows its empty state) rather than 500.
  return readOrDegrade("getViewerFavorites", async () => {
    const db = getDb();

    const rows = await db
      .select({ listing: listings })
      .from(favorites)
      .innerJoin(listings, eq(listings.id, favorites.listingId))
      .where(and(eq(favorites.userId, user.id), eq(listings.moderationStatus, "visible")))
      .orderBy(desc(favorites.createdAt));

    const viewerListings = rows.map((row) => row.listing);
    const listingIds = viewerListings.map((listing) => listing.id);

    // Same card builder as browse (the glance matches byte-for-byte); the
    // save-counts are batched alongside in one grouped query — no N+1.
    const [baseCards, favoriteCounts] = await Promise.all([
      buildBrowseCards(viewerListings, now, stalenessMonths),
      getFavoriteCounts(listingIds),
    ]);

    // A listing absent from the grouped aggregate defaults to 0 saves.
    return baseCards.map((card) => ({
      ...card,
      favoriteCount: favoriteCounts.get(card.listing.id) ?? 0,
    }));
  }, []);
}

/**
 * Public, user-agnostic favorite counts for the given listing ids: a grouped
 * `count(*)` over `favorites`, keyed by listing id.
 *
 * Empty input yields an empty map with no DB hit. Listings with no favorites
 * are absent from the map — callers default them to 0.
 */
export async function getFavoriteCounts(listingIds: string[]): Promise<Map<string, number>> {
  if (listingIds.length === 0) {
    return new Map();
  }

  // Runs on every browse render and on `/favorites` — degrade to an empty map
  // (cards default each count to 0) rather than 500 the directory.
  return readOrDegrade(
    "getFavoriteCounts",
    async () => {
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
    },
    new Map<string, number>()
  );
}
