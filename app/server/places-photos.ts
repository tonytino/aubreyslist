import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import { listings } from "~/db/schema";
import { getEnv } from "~/env";
import { getListing } from "~/server/listings/get-listing";
import { getSetting } from "~/server/settings";

/**
 * Render-time Google Place photos for the listing-detail hero (AUB-215,
 * ADR-014) AND the browse-surface cards / map carousel (AUB-219).
 *
 * COMPLIANCE POSTURE (ADR-014): Google content is NEVER persisted — no DB
 * column, no blob store, no committed JSON. This module fetches photo metadata
 * at render time, holds it only in a short-TTL in-process cache, and hands the
 * client a transient `photoToken` (the Google photo resource `name`) that the
 * `/api/places/photo` media proxy resolves server-side. The
 * `GOOGLE_PLACES_API_KEY` stays strictly server-side, exactly like
 * `~/server/places` (ADR-008).
 *
 * This is a deliberately separate, tight Place Details call with field mask
 * `photos` ONLY (Pro SKU) — it is not folded into the intake details call in
 * `~/server/places`, so the paid photo lookup happens only where a hero photo
 * is actually rendered and its result is cached per Place ID.
 *
 * Photos are DECORATIVE: every failure mode (kill switch off, key unset,
 * manual listing without a Place ID, upstream/network/shape errors) returns
 * `[]` — a `console.warn` server-side at most — and the hero falls back to its
 * brand gradient. This module must never break the listing page.
 *
 * BROWSE SURFACES (AUB-219): {@link getPhotosForListings} answers a whole PAGE
 * of listing ids in one call — the list cards and the map-carousel mini-cards
 * both derive their photo from it through the single `listingToCardVM` mapping
 * site (`~/components/listing/ListingCard`). It shares {@link fetchPhotosForPlace}
 * (and therefore the SAME per-Place-ID {@link listingPhotosCache}) with the hero
 * path, so a place already warmed by a detail-page view costs zero browse calls
 * and vice versa — at most one billed photos-only call per place per
 * {@link PLACE_PHOTOS_CACHE_TTL_MS} window, however many surfaces render it.
 * Every listing degrades independently to "no photo" (never throws), and a
 * cold cache fetches at most {@link BATCH_PHOTO_CONCURRENCY} places at once so
 * a full page of misses doesn't fire dozens of parallel Google calls.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * TTL for the in-process caches (photo metadata per Place ID here; resolved
 * media `photoUri` per (name, width) in the `/api/places/photo` route). 12
 * hours is the risk posture ADR-014 lands on: long enough that a popular
 * listing costs at most a couple of billed Place Details (photos-only) calls
 * per day per server instance, short enough that Google content is only ever
 * held transiently in memory — never persisted — and that a removed/updated
 * photo (or a flipped kill switch) propagates within half a day.
 */
export const PLACE_PHOTOS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** Hero surface only needs a handful — cap what we map and cache. */
export const MAX_LISTING_PHOTOS = 3;

/** Places API (New) place-details base — same endpoint family as `~/server/places`. */
const DETAILS_URL_BASE = "https://places.googleapis.com/v1/places";

// ---------------------------------------------------------------------------
// In-process TTL cache — the ONLY place Google photo data ever lives on our side
// ---------------------------------------------------------------------------

/**
 * Default entry cap for the photo caches. Keys are attacker-influenceable
 * (photo tokens / widths on the proxy, listing ids here), so an unbounded map
 * would be a memory-growth vector; a bounded FIFO keeps the worst case at a
 * few hundred KB while still covering every realistically-hot key.
 */
export const PLACE_PHOTOS_CACHE_MAX_ENTRIES = 1_000;

/**
 * Minimal in-process TTL cache. Values live in module memory only (ADR-014 —
 * transient by construction: a redeploy or instance recycle empties it) and
 * expire after `ttlMs`. Bounded: at `maxEntries` the OLDEST-INSERTED entry is
 * evicted (Map preserves insertion order — simple FIFO, no LRU bookkeeping
 * needed for a cache this small). Shared mechanism for photo-metadata-per-place
 * (this module) and resolved-photoUri / negative caches (`routes/places.ts`).
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number = PLACE_PHOTOS_CACHE_MAX_ENTRIES
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    // Delete-then-set so an overwritten key moves to the back of the eviction
    // order instead of aging out of turn.
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /** Drop everything — used by tests to isolate cases. */
  clear(): void {
    this.entries.clear();
  }
}

/** Photo metadata per Place ID. Exported so tests can `clear()` between cases. */
export const listingPhotosCache = new TtlCache<PlacePhoto[]>(PLACE_PHOTOS_CACHE_TTL_MS);

// ---------------------------------------------------------------------------
// Input / output shapes
// ---------------------------------------------------------------------------

/** Validated input for {@link runListingPhotos}: the listing's id. */
export const listingPhotosInputSchema = z.object({ listingId: z.string().min(1) });

/** Validated shape accepted by {@link runListingPhotos}. */
export type ListingPhotosInput = z.infer<typeof listingPhotosInputSchema>;

/** One photo author credit — required by Google's attribution terms. */
export interface PlacePhotoAttribution {
  displayName: string;
  /** Author profile link (https only — normalized/filtered server-side). */
  uri?: string;
}

/**
 * Client-safe photo descriptor. `photoToken` is the Google photo resource
 * `name` (`places/PLACE_ID/photos/RESOURCE`) — a TRANSIENT handle the client
 * feeds back to the `/api/places/photo` proxy. It is never persisted
 * (ADR-014) and contains no key material.
 */
export interface PlacePhoto {
  photoToken: string;
  widthPx: number;
  heightPx: number;
  attributions: PlacePhotoAttribution[];
}

// ---------------------------------------------------------------------------
// Upstream response schema (parse only what we use)
// ---------------------------------------------------------------------------

const photosResponseSchema = z.object({
  photos: z
    .array(
      z.object({
        name: z.string(),
        widthPx: z.number(),
        heightPx: z.number(),
        authorAttributions: z
          .array(
            z.object({
              displayName: z.string(),
              uri: z.string().optional(),
            })
          )
          .optional(),
      })
    )
    .optional(),
});

/**
 * Google returns author profile links protocol-relative
 * (`//www.google.com/maps/contrib/…`). Normalize to https and drop anything
 * that isn't an https URL afterwards — the client renders these as anchors, so
 * only a safe scheme may ever reach an `href` (same posture as `isHttpUrl` on
 * `mapsUrl`, #90).
 */
function normalizeAttributionUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const absolute = uri.startsWith("//") ? `https:${uri}` : uri;
  return absolute.startsWith("https://") ? absolute : undefined;
}

// ---------------------------------------------------------------------------
// Core operation (plain function — directly unit-testable with a mocked fetch)
// ---------------------------------------------------------------------------

/**
 * Fetch (or serve from cache) up to {@link MAX_LISTING_PHOTOS} client-safe
 * photo descriptors for ONE Place ID. Shared by {@link runListingPhotos} (hero,
 * one listing) and {@link getPhotosForListings} (browse, a page of listings) so
 * both paths write/read the SAME per-Place-ID {@link listingPhotosCache} — a
 * place warmed by either surface is warm for the other.
 *
 * Never throws: a successful lookup (including a legit "this place has no
 * photos" empty result) is cached for {@link PLACE_PHOTOS_CACHE_TTL_MS} and
 * returned; any failure (non-2xx, bad shape, network error) is logged via
 * `console.warn` (status/message only — never the response body, which may
 * reference the key/quota) and resolves to `[]`, NOT cached, so a later page
 * view may retry.
 */
async function fetchPhotosForPlace(placeId: string, apiKey: string): Promise<PlacePhoto[]> {
  const cached = listingPhotosCache.get(placeId);
  if (cached) return cached;

  try {
    const res = await fetch(`${DETAILS_URL_BASE}/${encodeURIComponent(placeId)}`, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        // Photos ONLY — keep this paid (Pro SKU) call as tight as possible.
        "X-Goog-FieldMask": "photos",
      },
    });

    if (!res.ok) {
      // Log status only; never echo the body (may reference key/quota).
      console.warn(`Place photos fetch failed: ${res.status} ${res.statusText}`);
      return [];
    }

    const parsed = photosResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("Place photos: unexpected response shape", parsed.error);
      return [];
    }

    const photos: PlacePhoto[] = (parsed.data.photos ?? [])
      .slice(0, MAX_LISTING_PHOTOS)
      .map((photo) => ({
        photoToken: photo.name,
        widthPx: photo.widthPx,
        heightPx: photo.heightPx,
        attributions: (photo.authorAttributions ?? []).map((author) => {
          const uri = normalizeAttributionUri(author.uri);
          return uri === undefined
            ? { displayName: author.displayName }
            : { displayName: author.displayName, uri };
        }),
      }));

    listingPhotosCache.set(placeId, photos);
    return photos;
  } catch (err) {
    // Decorative surface: any unexpected failure (network, DB, …) degrades to
    // the gradient fallback rather than breaking the page.
    console.warn("Place photos lookup failed:", err);
    return [];
  }
}

/**
 * Listing id -> up to {@link MAX_LISTING_PHOTOS} client-safe photo descriptors.
 *
 * Guard order (each short-circuits to `[]` with no upstream call):
 * 1. `place_photos_enabled` kill switch off (AppSetting, default on),
 * 2. `GOOGLE_PLACES_API_KEY` unset,
 * 3. listing missing/hidden ({@link getListing} is visibility-aware) or has no
 *    Place ID (manual entry).
 *
 * Delegates the actual fetch+cache to {@link fetchPhotosForPlace}; see its doc
 * for the caching/failure contract.
 */
export async function runListingPhotos({ listingId }: ListingPhotosInput): Promise<PlacePhoto[]> {
  try {
    if (!(await getSetting("place_photos_enabled"))) return [];

    const apiKey = getEnv().GOOGLE_PLACES_API_KEY;
    if (!apiKey) return [];

    const listing = await getListing({ id: listingId });
    const placeId = listing?.placeId;
    if (!placeId) return [];

    return await fetchPhotosForPlace(placeId, apiKey);
  } catch (err) {
    // Decorative surface: any unexpected failure (network, DB, …) degrades to
    // the gradient fallback rather than breaking the listing page.
    console.warn("Place photos lookup failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Batch operation — browse cards + map carousel (AUB-219)
// ---------------------------------------------------------------------------

/** Hard cap on how many listing ids one {@link getPhotosForListings} call accepts. */
export const MAX_BATCH_LISTING_IDS = 60;

/**
 * How many upstream Place Details calls {@link getPhotosForListings} allows in
 * flight at once. A cold cache (e.g. right after a deploy recycles the
 * in-process cache) could otherwise fire one parallel Google call per
 * uncached listing on the page — this keeps a full page of misses to a modest,
 * steady trickle instead of a burst.
 */
export const BATCH_PHOTO_CONCURRENCY = 5;

/** Validated input for {@link getPhotosForListings}. */
export const listingIdsInputSchema = z.object({
  listingIds: z.array(z.string().min(1)).min(1).max(MAX_BATCH_LISTING_IDS),
});

/** Validated shape accepted by {@link getPhotosForListings}. */
export type ListingIdsInput = z.infer<typeof listingIdsInputSchema>;

/** Client-safe result of {@link getPhotosForListings}: listing id -> its ONE hero photo. */
export type ListingPhotoMap = Record<string, PlacePhoto>;

/**
 * Run `fn` over `items` with at most `limit` calls in flight at once,
 * collecting each result keyed by its input item. A tiny, dependency-free
 * worker-pool (no new dependency needed for a bound this narrow) — `limit`
 * workers each pull the next unclaimed index off a shared cursor until the
 * queue is empty.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<Map<T, R>> {
  const results = new Map<T, R>();
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) continue;
      results.set(item, await fn(item));
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/**
 * Look up the Place ID for every VISIBLE listing among `listingIds`, in one
 * batched query (no N+1) — mirrors the visibility rule in {@link getListing}
 * (a hidden/removed listing is treated as if it didn't exist). Manual listings
 * (`placeId` null) are simply absent from the returned map.
 */
async function getPlaceIdsForListings(listingIds: string[]): Promise<Map<string, string>> {
  const rows = await getDb()
    .select({ id: listings.id, placeId: listings.placeId })
    .from(listings)
    .where(and(inArray(listings.id, listingIds), eq(listings.moderationStatus, "visible")));

  const placeIdByListingId = new Map<string, string>();
  for (const row of rows) {
    if (row.placeId) placeIdByListingId.set(row.id, row.placeId);
  }
  return placeIdByListingId;
}

/**
 * Batched browse-surface lookup (AUB-219): listing id -> its single hero photo
 * (the FIRST photo {@link fetchPhotosForPlace} returns for that listing's
 * Place ID), for every id in `listingIds` that has one. Powers the browse list
 * cards AND the map-carousel mini-cards through the one `listingToCardVM`
 * mapping site — both surfaces agree because they both read this same map.
 *
 * Guard order (each short-circuits to `{}` with no upstream call, mirroring
 * {@link runListingPhotos}):
 * 1. `place_photos_enabled` kill switch off,
 * 2. `GOOGLE_PLACES_API_KEY` unset.
 *
 * Cost bounding:
 * - Reuses the SAME per-Place-ID {@link listingPhotosCache} as the hero path —
 *   a place already warmed by a detail-page view (or an earlier browse page)
 *   costs zero calls here, and vice versa.
 * - Distinct Place IDs are deduped BEFORE fetching (two listings can't double
 *   the cost of one place), and fetched with at most
 *   {@link BATCH_PHOTO_CONCURRENCY} calls in flight (`mapWithConcurrency`).
 * - Manual listings (no Place ID) are omitted with no DB/upstream cost.
 *
 * Failure isolation: a single listing/place's failure resolves to that
 * listing being ABSENT from the returned map (never a thrown error, never a
 * partial/malformed entry) — `fetchPhotosForPlace` already degrades
 * per-place failures to `[]` internally. A failure in the batch's own DB
 * lookup (or any other unexpected error) degrades the WHOLE call to `{}` via
 * the outer catch, exactly like `runListingPhotos` degrades to `[]` — photos
 * are decorative and must never fail the browse page.
 */
export async function getPhotosForListings({
  listingIds,
}: ListingIdsInput): Promise<ListingPhotoMap> {
  try {
    if (!(await getSetting("place_photos_enabled"))) return {};

    const apiKey = getEnv().GOOGLE_PLACES_API_KEY;
    if (!apiKey) return {};

    // Defensive de-dup: the browse route already sends a page's unique ids, but
    // a batch entry point shouldn't do (or bill) redundant work if it doesn't.
    const uniqueListingIds = Array.from(new Set(listingIds));
    const placeIdByListingId = await getPlaceIdsForListings(uniqueListingIds);
    if (placeIdByListingId.size === 0) return {};

    const uniquePlaceIds = Array.from(new Set(placeIdByListingId.values()));
    const photosByPlaceId = await mapWithConcurrency(
      uniquePlaceIds,
      BATCH_PHOTO_CONCURRENCY,
      (placeId) => fetchPhotosForPlace(placeId, apiKey)
    );

    const result: ListingPhotoMap = {};
    for (const [listingId, placeId] of placeIdByListingId) {
      const photo = photosByPlaceId.get(placeId)?.[0];
      if (photo) result[listingId] = photo;
    }
    return result;
  } catch (err) {
    // Decorative surface: any unexpected failure (network, DB, …) degrades to
    // "no photos this page" rather than breaking browse.
    console.warn("Batch place photos lookup failed:", err);
    return {};
  }
}
