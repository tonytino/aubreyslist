import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { getEnv } from "~/env";
import { PLACE_PHOTOS_CACHE_TTL_MS, TtlCache } from "~/server/places-photos";
import { getSetting } from "~/server/settings";

/**
 * Google Place photo media proxy (AUB-215, ADR-013).
 *
 * `GET /api/places/photo?name=places/{placeId}/photos/{resource}&maxWidthPx=…`
 *
 * The listing-detail hero renders `<img src="/api/places/photo?…">`; this
 * route resolves the transient photo token to Google's short-lived media URL
 * SERVER-SIDE (the `GOOGLE_PLACES_API_KEY` never reaches the client) and
 * answers with a 302 to that `photoUri`. Nothing Google-sourced is persisted:
 * the resolved URI lives only in a short-TTL in-process cache and in the
 * browser's HTTP cache (bounded by the short `Cache-Control` below).
 *
 * Why a Hono route and not a server fn: the consumer is the browser's image
 * loader — a plain GET URL — not route data, so it needs a real HTTP endpoint
 * (`docs/agents/api.md` decision rule). The frontend never `fetch`es it; it is
 * only ever an `<img src>`, so the RPC-client rule doesn't apply.
 */

/**
 * Google photo resource name: `places/{placeId}/photos/{resource}` exactly —
 * one segment each, no extra path. Validation alone isn't trusted for URL
 * building: the two segments are re-encoded below so no character in a token
 * can splice extra path segments or query params into the upstream request.
 */
const PHOTO_NAME_PATTERN = /^places\/[^/]+\/photos\/[^/]+$/;

/** Bounds for the requested render width (Google accepts 1–4800). */
const MIN_PHOTO_WIDTH_PX = 64;
const MAX_PHOTO_WIDTH_PX = 1600;
const DEFAULT_PHOTO_WIDTH_PX = 960;

/**
 * How long browsers/CDNs may reuse the 302 (and clients should wait after a
 * 503). Kept SHORT — one hour, well under the in-process TTL — because the
 * redirect target is a short-lived googleusercontent URL and because a flipped
 * kill switch must take effect quickly (ADR-013).
 */
const PHOTO_REDIRECT_MAX_AGE_SECONDS = 3600;

const photoQuerySchema = z.object({
  name: z
    .string()
    .regex(PHOTO_NAME_PATTERN, "Expected places/{placeId}/photos/{resource}")
    // `[^/]+` alone admits "." / ".." segments, and dots survive
    // encodeURIComponent — reject them so a token can never path-traverse the
    // upstream URL.
    .refine((name) => name.split("/").every((segment) => segment !== "." && segment !== ".."), {
      message: "Invalid photo name segment",
    }),
  // Query params arrive as strings; coerce, default, then CLAMP (out-of-range
  // asks are normalized, not rejected — width is a rendering hint, not intent).
  maxWidthPx: z.coerce
    .number()
    .int()
    .default(DEFAULT_PHOTO_WIDTH_PX)
    .transform((n) => Math.min(MAX_PHOTO_WIDTH_PX, Math.max(MIN_PHOTO_WIDTH_PX, n))),
});

/** Upstream `skipHttpRedirect=true` response — the media URL without the bytes. */
const photoMediaResponseSchema = z.object({ photoUri: z.string().url() });

/**
 * Resolved `photoUri` per (name, width) — same TTL-cache mechanism (and ADR-013
 * transience rationale) as the photo-metadata cache in `~/server/places-photos`.
 * Exported so tests can `clear()` between cases.
 */
export const photoUriCache = new TtlCache<string>(PLACE_PHOTOS_CACHE_TTL_MS);

export const placesRoutes = new Hono().get(
  "/photo",
  zValidator("query", photoQuerySchema),
  async (c) => {
    const { name, maxWidthPx } = c.req.valid("query");

    // Kill switch (AppSetting `place_photos_enabled`, default on) + key guard.
    // Either off → 503 with Retry-After so image loaders/CDNs back off politely.
    // A settings read failure counts as "off": photos are decorative and this
    // endpoint must degrade, never 500.
    let enabled = false;
    try {
      enabled = await getSetting("place_photos_enabled");
    } catch (err) {
      console.warn("Place photo proxy: settings read failed", err);
    }
    const apiKey = getEnv().GOOGLE_PLACES_API_KEY;
    if (!enabled || !apiKey) {
      c.header("Retry-After", String(PHOTO_REDIRECT_MAX_AGE_SECONDS));
      return c.json({ error: "Place photos are currently unavailable" }, 503);
    }

    const cacheKey = `${name}@${maxWidthPx}`;
    const cached = photoUriCache.get(cacheKey);
    if (cached !== undefined) {
      return redirectToPhoto(c, cached);
    }

    // Rebuild the upstream path from the validated segments, re-encoding each
    // so nothing in a token can alter the path or query we send to Google.
    // Shape is guaranteed by PHOTO_NAME_PATTERN: places/{placeId}/photos/{resource}.
    const [, placeId = "", , resource = ""] = name.split("/");
    const mediaUrl =
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}` +
      `/photos/${encodeURIComponent(resource)}/media` +
      `?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true`;

    let raw: unknown;
    try {
      const res = await fetch(mediaUrl, {
        method: "GET",
        headers: { "X-Goog-Api-Key": apiKey },
      });
      if (!res.ok) {
        // Status only — never relay the upstream body (no stack/quota/key leak).
        console.warn(`Place photo media fetch failed: ${res.status} ${res.statusText}`);
        return c.json({ error: "Photo is unavailable" }, 502);
      }
      raw = await res.json();
    } catch (err) {
      console.warn("Place photo media network error:", err);
      return c.json({ error: "Photo is unavailable" }, 502);
    }

    const parsed = photoMediaResponseSchema.safeParse(raw);
    // The redirect target must be https — we never bounce a browser to an
    // arbitrary scheme, even if upstream misbehaves.
    if (!parsed.success || !parsed.data.photoUri.startsWith("https://")) {
      console.warn("Place photo media: unexpected response shape");
      return c.json({ error: "Photo is unavailable" }, 502);
    }

    photoUriCache.set(cacheKey, parsed.data.photoUri);
    return redirectToPhoto(c, parsed.data.photoUri);
  }
);

/** 302 to the resolved googleusercontent URL with a short public cache window. */
function redirectToPhoto(c: Context, uri: string) {
  c.header("Cache-Control", `public, max-age=${PHOTO_REDIRECT_MAX_AGE_SECONDS}`);
  return c.redirect(uri, 302);
}
