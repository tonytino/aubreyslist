import { z } from "zod";
import { getEnv } from "~/env";
import { getListing } from "~/server/listings/get-listing";
import { getSetting } from "~/server/settings";

/**
 * Render-time Google Place photos for the listing-detail hero (AUB-215,
 * ADR-013).
 *
 * COMPLIANCE POSTURE (ADR-013): Google content is NEVER persisted — no DB
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
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * TTL for the in-process caches (photo metadata per Place ID here; resolved
 * media `photoUri` per (name, width) in the `/api/places/photo` route). 12
 * hours is the risk posture ADR-013 lands on: long enough that a popular
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
 * Minimal in-process TTL cache. Values live in module memory only (ADR-013 —
 * transient by construction: a redeploy or instance recycle empties it) and
 * expire after `ttlMs`. Shared mechanism for both photo-metadata-per-place
 * (this module) and resolved-photoUri-per-(name,width) (`routes/places.ts`).
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

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
 * (ADR-013) and contains no key material.
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
 * Listing id -> up to {@link MAX_LISTING_PHOTOS} client-safe photo descriptors.
 *
 * Guard order (each short-circuits to `[]` with no upstream call):
 * 1. `place_photos_enabled` kill switch off (AppSetting, default on),
 * 2. `GOOGLE_PLACES_API_KEY` unset,
 * 3. listing missing/hidden ({@link getListing} is visibility-aware) or has no
 *    Place ID (manual entry).
 *
 * Successful lookups (including a legit "this place has no photos" empty
 * result) are cached per Place ID for {@link PLACE_PHOTOS_CACHE_TTL_MS}.
 * Failures are NOT cached — decorative data may retry on a later page view —
 * and always resolve to `[]` after a `console.warn`, never a throw.
 */
export async function runListingPhotos({ listingId }: ListingPhotosInput): Promise<PlacePhoto[]> {
  try {
    if (!(await getSetting("place_photos_enabled"))) return [];

    const apiKey = getEnv().GOOGLE_PLACES_API_KEY;
    if (!apiKey) return [];

    const listing = await getListing({ id: listingId });
    const placeId = listing?.placeId;
    if (!placeId) return [];

    const cached = listingPhotosCache.get(placeId);
    if (cached) return cached;

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
    // the gradient fallback rather than breaking the listing page.
    console.warn("Place photos lookup failed:", err);
    return [];
  }
}
