import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks -----------------------------------------------------------------
// The proxy's server-only collaborators (env accessor + app-settings read) are
// mocked, plus global `fetch`, so the handler runs without a key, a database,
// or a real Google call.

const getEnvMock = vi.fn();
vi.mock("~/env", () => ({ getEnv: () => getEnvMock() }));

const getSettingMock = vi.fn((_key: string) => Promise.resolve<unknown>(true));
vi.mock("~/server/settings", () => ({
  getSetting: (key: string) => getSettingMock(key),
}));

import { PLACE_PHOTOS_CACHE_TTL_MS } from "~/server/places-photos";
import {
  PHOTO_FAILURE_CACHE_TTL_MS,
  PHOTO_WIDTH_LADDER,
  photoFailureCache,
  photoRateLimiter,
  photoUriCache,
  placesRoutes,
} from "./places";

/** Mount under the same prefix the real app uses (`app/server/index.ts`). */
const app = new Hono().basePath("/api").route("/places", placesRoutes);

const PHOTO_NAME = "places/ChIJ_place/photos/resource-1";
const PHOTO_URI = "https://lh3.googleusercontent.com/place-photos/resolved";

function photoRequest(query: string, headers: Record<string, string> = {}) {
  return app.request(`/api/places/photo?${query}`, { headers });
}

function mockMediaFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "ERR",
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  photoUriCache.clear();
  photoFailureCache.clear();
  photoRateLimiter.clear();
  getEnvMock.mockReturnValue({ GOOGLE_PLACES_API_KEY: "test-key" });
  getSettingMock.mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GET /api/places/photo", () => {
  it("302-redirects to the server-resolved photoUri with a short public cache window", async () => {
    const fetchSpy = mockMediaFetch({ photoUri: PHOTO_URI });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}&maxWidthPx=640`);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(PHOTO_URI);
    expect(res.headers.get("cache-control")).toBe("public, max-age=21600");

    // Upstream call: media endpoint for the token, skipHttpRedirect, key in a
    // header — never in the URL (it must not be leakable via redirects/logs).
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://places.googleapis.com/v1/places/ChIJ_place/photos/resource-1/media?maxWidthPx=640&skipHttpRedirect=true"
    );
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(String(url)).not.toContain("test-key");
  });

  it("defaults maxWidthPx to 960 and quantizes every request to the width ladder", async () => {
    const fetchSpy = mockMediaFetch({ photoUri: PHOTO_URI });
    vi.stubGlobal("fetch", fetchSpy);

    // Default is a rung.
    await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}`);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("maxWidthPx=960");

    // Snap up to the nearest rung; above the top rung snaps down to it; a rung
    // stays itself. The ladder value reaches the upstream URL — never the raw ask.
    const cases: Array<[requested: number, rung: number]> = [
      [1, 320],
      [64, 320],
      [321, 640],
      [700, 960],
      [1280, 1280],
      [1599, 1600],
      [99999, 1600],
    ];
    for (const [requested, rung] of cases) {
      fetchSpy.mockClear();
      photoUriCache.clear();
      await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}&maxWidthPx=${requested}`);
      expect(String(fetchSpy.mock.calls[0]?.[0]), `requested=${requested}`).toContain(
        `maxWidthPx=${rung}`
      );
    }
  });

  it("quantization collapses the per-token cache key space to the ladder", async () => {
    // A harvested token can cost at most one upstream call per ladder rung
    // per TTL window — sweeping many distinct widths must not mint distinct
    // billed calls (the quota-oracle attack).
    const fetchSpy = mockMediaFetch({ photoUri: PHOTO_URI });
    vi.stubGlobal("fetch", fetchSpy);

    // Sample the whole 64–1600 range (kept under the per-IP budget).
    for (let width = 64; width <= 1600; width += 100) {
      await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}&maxWidthPx=${width}`);
    }
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(PHOTO_WIDTH_LADDER.length);
  });

  it("rejects a malformed photo name with 400 before any upstream call", async () => {
    const fetchSpy = mockMediaFetch({ photoUri: PHOTO_URI });
    vi.stubGlobal("fetch", fetchSpy);

    for (const bad of [
      "not-a-photo-name",
      "places/onlytwo",
      "places/x/photos/y/extra",
      "places//photos/y",
      // Traversal/query smuggling shapes must not validate either.
      "places/../photos/media",
    ]) {
      const res = await photoRequest(`name=${encodeURIComponent(bad)}`);
      expect(res.status, `name=${bad}`).toBe(400);
    }
    // Missing name entirely.
    expect((await photoRequest("maxWidthPx=640")).status).toBe(400);
    // Non-numeric width.
    expect(
      (await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}&maxWidthPx=abc`)).status
    ).toBe(400);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 503 with Retry-After when the kill switch is off (no upstream call)", async () => {
    getSettingMock.mockResolvedValue(false);
    const fetchSpy = mockMediaFetch({ photoUri: PHOTO_URI });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}`);

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("3600");
    expect(await res.json()).toEqual({ error: "Place photos are currently unavailable" });
    expect(getSettingMock).toHaveBeenCalledWith("place_photos_enabled");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 503 with Retry-After when the API key is unset (no upstream call)", async () => {
    getEnvMock.mockReturnValue({ GOOGLE_PLACES_API_KEY: undefined });
    const fetchSpy = mockMediaFetch({ photoUri: PHOTO_URI });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}`);

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("3600");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("degrades to 503 (never 500) when the settings read itself throws", async () => {
    getSettingMock.mockRejectedValue(new Error("db down"));
    vi.stubGlobal("fetch", mockMediaFetch({ photoUri: PHOTO_URI }));

    const res = await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}`);
    expect(res.status).toBe(503);
  });

  it("maps an upstream non-200 to a lean 502 JSON (no stack, no upstream body)", async () => {
    vi.stubGlobal("fetch", mockMediaFetch({ secret: "quota-details" }, false, 403));

    const res = await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}`);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Photo is unavailable" });
  });

  it("maps a network error and a bad upstream shape to 502", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    expect((await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}`)).status).toBe(502);

    photoFailureCache.clear();
    vi.stubGlobal("fetch", mockMediaFetch({ nope: true }));
    expect((await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}`)).status).toBe(502);

    // A non-https photoUri must never become a redirect target.
    photoFailureCache.clear();
    vi.stubGlobal("fetch", mockMediaFetch({ photoUri: "http://evil.example/x" }));
    expect((await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}`)).status).toBe(502);
  });

  describe("per-(name,width) TTL cache", () => {
    it("serves a repeat request from cache within the TTL, refetches after expiry", async () => {
      vi.useFakeTimers();
      const fetchSpy = mockMediaFetch({ photoUri: PHOTO_URI });
      vi.stubGlobal("fetch", fetchSpy);

      const query = `name=${encodeURIComponent(PHOTO_NAME)}&maxWidthPx=640`;
      const first = await photoRequest(query);
      const second = await photoRequest(query);
      expect(first.status).toBe(302);
      expect(second.status).toBe(302);
      expect(second.headers.get("location")).toBe(PHOTO_URI);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // A different ladder width is a different cache entry.
      await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}&maxWidthPx=1280`);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Past the TTL the original entry expires and is re-resolved.
      vi.advanceTimersByTime(PLACE_PHOTOS_CACHE_TTL_MS + 1);
      await photoRequest(query);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it("negative-caches upstream failures briefly, then allows a retry", async () => {
      vi.useFakeTimers();
      const failSpy = mockMediaFetch({}, false, 500);
      vi.stubGlobal("fetch", failSpy);

      const query = `name=${encodeURIComponent(PHOTO_NAME)}`;
      expect((await photoRequest(query)).status).toBe(502);
      // Repeats inside the negative-cache window still 502 but cost no new
      // upstream call — a bogus token can't drive one billed call per request.
      expect((await photoRequest(query)).status).toBe(502);
      expect((await photoRequest(query)).status).toBe(502);
      expect(failSpy).toHaveBeenCalledTimes(1);

      // The negative entry is per (name, width): a different rung retries.
      await photoRequest(`${query}&maxWidthPx=320`);
      expect(failSpy).toHaveBeenCalledTimes(2);

      // After the (short) failure TTL, the original retries — and can recover.
      vi.advanceTimersByTime(PHOTO_FAILURE_CACHE_TTL_MS + 1);
      const okSpy = mockMediaFetch({ photoUri: PHOTO_URI });
      vi.stubGlobal("fetch", okSpy);
      const recovered = await photoRequest(query);
      expect(recovered.status).toBe(302);
      expect(okSpy).toHaveBeenCalledTimes(1);
    });

    it("a failure never poisons the positive cache", async () => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", mockMediaFetch({}, false, 500));
      const query = `name=${encodeURIComponent(PHOTO_NAME)}`;
      await photoRequest(query);

      // Once the negative window passes, a healthy upstream serves (and caches)
      // the real URI — the earlier failure left nothing behind in photoUriCache.
      vi.advanceTimersByTime(PHOTO_FAILURE_CACHE_TTL_MS + 1);
      const fetchSpy = mockMediaFetch({ photoUri: PHOTO_URI });
      vi.stubGlobal("fetch", fetchSpy);
      expect((await photoRequest(query)).status).toBe(302);
      expect((await photoRequest(query)).status).toBe(302);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("per-IP rate limit", () => {
    it("429s an IP that exceeds the budget, without touching upstream", async () => {
      const fetchSpy = mockMediaFetch({ photoUri: PHOTO_URI });
      vi.stubGlobal("fetch", fetchSpy);
      const headers = { "x-forwarded-for": "203.0.113.7" };
      const query = `name=${encodeURIComponent(PHOTO_NAME)}`;

      // Exhaust the per-IP budget (all cache hits after the first — cheap).
      let lastStatus = 0;
      for (let i = 0; i < 60; i++) {
        lastStatus = (await photoRequest(query, headers)).status;
      }
      expect(lastStatus).toBe(302);

      const limited = await photoRequest(query, headers);
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("60");
      expect(await limited.json()).toEqual({ error: "Too many photo requests" });
      // Only the very first request reached upstream (the rest were cache hits,
      // and the 429 short-circuits before any upstream work).
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("meters IPs independently (first XFF hop is the key)", async () => {
      vi.stubGlobal("fetch", mockMediaFetch({ photoUri: PHOTO_URI }));
      const query = `name=${encodeURIComponent(PHOTO_NAME)}`;

      for (let i = 0; i < 61; i++) {
        await photoRequest(query, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
      }
      // The exhausted IP is limited…
      expect(
        (await photoRequest(query, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" })).status
      ).toBe(429);
      // …while a different client IP still gets served.
      expect((await photoRequest(query, { "x-forwarded-for": "198.51.100.9" })).status).toBe(302);
    });
  });
});
