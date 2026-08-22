import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { getEnv } from "~/env";
import { PLACE_PHOTOS_CACHE_TTL_MS, TtlCache } from "~/server/places-photos";
import { InMemoryRateLimiter } from "~/server/rate-limit";
import { getSetting } from "~/server/settings";

/**
 * Google Place photo media proxy (ADR-014).
 *
 * `GET /api/places/photo?name=places/{placeId}/photos/{resource}&maxWidthPx=…`
 *
 * The listing-detail hero renders `<img src="/api/places/photo?…">`; this
 * route resolves the transient photo token to Google's short-lived media URL
 * server-side (the `GOOGLE_PLACES_API_KEY` never reaches the client) and
 * answers with a 302 to that `photoUri`. Nothing Google-sourced is persisted:
 * the resolved URI lives only in a short-TTL in-process cache and in the
 * browser's HTTP cache (bounded by the short `Cache-Control` below).
 *
 * A Hono route, not a server fn: the consumer is the browser's image loader —
 * a plain GET URL, not route data — so it needs a real HTTP endpoint
 * (`docs/agents/api.md` decision rule). It is only ever an `<img src>`, never
 * `fetch`ed, so the RPC-client rule doesn't apply.
 *
 * Cost controls — this endpoint fronts a paid upstream and must stay
 * anonymous because it serves `<img>` loads on a public page. Abuse is
 * blunted in layers, each testable on its own:
 *  1. width quantization to a fixed ladder — a harvested token yields at most
 *     `PHOTO_WIDTH_LADDER.length` distinct upstream calls, not one per integer;
 *  2. a positive cache per (name, ladder-width) — repeats are free;
 *  3. a short negative cache per (name, ladder-width) — well-formed-but-bogus
 *     tokens (or a flapping upstream) can't drive one billed call per request;
 *  4. a per-IP rate limit reusing the repo's `InMemoryRateLimiter` — photos
 *     are decorative, so a 429 under abuse costs nothing user-visible.
 * All in-process and best-effort per instance (same serverless caveat as
 * `~/server/rate-limit`) — a guardrail, not a billing-grade global quota.
 */

/**
 * Google photo resource name: `places/{placeId}/photos/{resource}` exactly —
 * one segment each, no extra path. Validation alone isn't trusted for URL
 * building: the two segments are re-encoded below so no character in a token
 * can splice extra path segments or query params into the upstream request.
 */
const PHOTO_NAME_PATTERN = /^places\/[^/]+\/photos\/[^/]+$/;

/**
 * The only widths ever requested upstream. A requested width snaps up to the
 * nearest rung (above the top rung snaps down to it), and the ladder value is
 * used for both the cache key and the upstream URL — so one photo token can
 * cost at most `PHOTO_WIDTH_LADDER.length` billed calls per TTL window, not
 * one per integer in a naive clamp range.
 */
export const PHOTO_WIDTH_LADDER = [320, 640, 960, 1280, 1600] as const;
// `.at(-1)` types as `number | undefined` under noUncheckedIndexedAccess; the
// tuple is non-empty by construction, so the fallback is unreachable.
const MAX_PHOTO_WIDTH_PX: number = PHOTO_WIDTH_LADDER.at(-1) ?? 1600;
const DEFAULT_PHOTO_WIDTH_PX = 960;

/** Snap a requested width up to the nearest ladder rung (down from above the top). */
function snapToWidthLadder(requested: number): number {
  return PHOTO_WIDTH_LADDER.find((rung) => rung >= requested) ?? MAX_PHOTO_WIDTH_PX;
}

/**
 * How long browsers/CDNs may reuse the 302. Six hours — under the 12h
 * in-process metadata TTL (`PLACE_PHOTOS_CACHE_TTL_MS`, `~/server/places-photos`)
 * and still short enough for the short-lived googleusercontent redirect
 * target to stay valid across the window. A flipped `place_photos_enabled`
 * kill switch may take up to this long to reach a browser holding a cached
 * redirect — an accepted tradeoff against fewer redirect round-trips on
 * repeat photo views. Deliberately separate from
 * {@link PHOTO_UNAVAILABLE_RETRY_AFTER_SECONDS}: this only governs a
 * SUCCESSFUL redirect's cache lifetime, never a 503's retry hint, so a longer
 * redirect cache can't also delay how soon a client retries after the kill
 * switch flips back ON.
 */
const PHOTO_REDIRECT_MAX_AGE_SECONDS = 21_600;

/**
 * `Retry-After` hint on a 503 (kill switch off / key unset). One hour — short
 * enough that a client notices soon after the kill switch is RE-ENABLED,
 * independent of {@link PHOTO_REDIRECT_MAX_AGE_SECONDS}'s longer redirect
 * cache window.
 */
const PHOTO_UNAVAILABLE_RETRY_AFTER_SECONDS = 3600;

/**
 * Negative-cache TTL for upstream failures, per (name, ladder-width). Long
 * enough that a burst of requests for a dead/bogus token costs one upstream
 * call a minute instead of one per request; short enough that a transient
 * upstream blip only suppresses a legitimate photo for about a minute.
 */
export const PHOTO_FAILURE_CACHE_TTL_MS = 60_000;

/**
 * Per-IP request budget. Generous for real browsing (the hero loads one image
 * per listing view, so 60/min ≈ a page a second) while capping what a single
 * scripted client can push through this paid proxy per instance-minute.
 */
const PHOTO_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

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
  // Query params arrive as strings; coerce, default, then quantize to the
  // ladder (out-of-range/odd asks are normalized, not rejected — width is a
  // rendering hint, not intent).
  maxWidthPx: z.coerce.number().int().default(DEFAULT_PHOTO_WIDTH_PX).transform(snapToWidthLadder),
});

/** Upstream `skipHttpRedirect=true` response — the media URL without the bytes. */
const photoMediaResponseSchema = z.object({ photoUri: z.string().url() });

/**
 * Resolved `photoUri` per (name, ladder-width) — same bounded TTL-cache
 * mechanism (and ADR-014 transience rationale) as the photo-metadata cache
 * in `~/server/places-photos`. Exported so tests can `clear()` between cases.
 */
export const photoUriCache = new TtlCache<string>(PLACE_PHOTOS_CACHE_TTL_MS);

/**
 * Recent upstream failures per (name, ladder-width) — cost-control layer 3.
 * Exported so tests can `clear()` between cases.
 */
export const photoFailureCache = new TtlCache<true>(PHOTO_FAILURE_CACHE_TTL_MS);

/**
 * Per-IP limiter — cost-control layer 4, reusing the in-process rate-limit
 * mechanism from `app/server/rate-limit`. Keyed by IP rather than user id
 * because this endpoint is deliberately anonymous. Exported so tests can
 * `clear()` between cases.
 */
export const photoRateLimiter = new InMemoryRateLimiter(PHOTO_RATE_LIMIT);

/**
 * Best-effort client IP: first hop of `x-forwarded-for` (always set by
 * Vercel/most proxies), else `x-real-ip`, else a shared "unknown" bucket —
 * which fails safe for cost (unattributable traffic shares one budget).
 */
function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || c.req.header("x-real-ip") || "unknown";
}

export const placesRoutes = new Hono().get(
  "/photo",
  zValidator("query", photoQuerySchema),
  async (c) => {
    const { name, maxWidthPx } = c.req.valid("query");

    // Per-IP budget first — the cheapest guard, and it also shields the
    // settings read below from being hammered. Photos are decorative, so a
    // flat 429 (with a shortish back-off hint) is fine under abuse.
    if (!photoRateLimiter.hit(clientIp(c))) {
      c.header("Retry-After", String(Math.ceil(PHOTO_RATE_LIMIT.windowMs / 1000)));
      return c.json({ error: "Too many photo requests" }, 429);
    }

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
      c.header("Retry-After", String(PHOTO_UNAVAILABLE_RETRY_AFTER_SECONDS));
      return c.json({ error: "Place photos are currently unavailable" }, 503);
    }

    // maxWidthPx is already quantized to the ladder by the validator, so the
    // cache key space per token is the ladder, nothing more.
    const cacheKey = `${name}@${maxWidthPx}`;
    const cached = photoUriCache.get(cacheKey);
    if (cached !== undefined) {
      return redirectToPhoto(c, cached);
    }

    // Negative cache: a recent upstream failure for this exact (name, width)
    // short-circuits to 502 without a new billed call.
    if (photoFailureCache.get(cacheKey)) {
      return c.json({ error: "Photo is unavailable" }, 502);
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
        return photoUnavailable(c, cacheKey);
      }
      raw = await res.json();
    } catch (err) {
      console.warn("Place photo media network error:", err);
      return photoUnavailable(c, cacheKey);
    }

    const parsed = photoMediaResponseSchema.safeParse(raw);
    // The redirect target must be https — we never bounce a browser to an
    // arbitrary scheme, even if upstream misbehaves.
    if (!parsed.success || !parsed.data.photoUri.startsWith("https://")) {
      console.warn("Place photo media: unexpected response shape");
      return photoUnavailable(c, cacheKey);
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

/** Record the failure in the negative cache and answer a lean 502. */
function photoUnavailable(c: Context, cacheKey: string) {
  photoFailureCache.set(cacheKey, true);
  return c.json({ error: "Photo is unavailable" }, 502);
}
