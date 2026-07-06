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
import { photoUriCache, placesRoutes } from "./places";

/** Mount under the same prefix the real app uses (`app/server/index.ts`). */
const app = new Hono().basePath("/api").route("/places", placesRoutes);

const PHOTO_NAME = "places/ChIJ_place/photos/resource-1";
const PHOTO_URI = "https://lh3.googleusercontent.com/place-photos/resolved";

function photoRequest(query: string) {
  return app.request(`/api/places/photo?${query}`);
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
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");

    // Upstream call: media endpoint for the token, skipHttpRedirect, key in a
    // header — NEVER in the URL (it must not be leakable via redirects/logs).
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://places.googleapis.com/v1/places/ChIJ_place/photos/resource-1/media?maxWidthPx=640&skipHttpRedirect=true"
    );
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(String(url)).not.toContain("test-key");
  });

  it("defaults maxWidthPx to 960 and clamps it to the 64–1600 range", async () => {
    const fetchSpy = mockMediaFetch({ photoUri: PHOTO_URI });
    vi.stubGlobal("fetch", fetchSpy);

    await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}`);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("maxWidthPx=960");

    await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}&maxWidthPx=99999`);
    expect(String(fetchSpy.mock.calls[1]?.[0])).toContain("maxWidthPx=1600");

    await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}&maxWidthPx=1`);
    expect(String(fetchSpy.mock.calls[2]?.[0])).toContain("maxWidthPx=64");
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

    vi.stubGlobal("fetch", mockMediaFetch({ nope: true }));
    expect((await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}`)).status).toBe(502);

    // A non-https photoUri must never become a redirect target.
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

      // A DIFFERENT width is a different cache entry.
      await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}&maxWidthPx=1280`);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Past the TTL the original entry expires and is re-resolved.
      vi.advanceTimersByTime(PLACE_PHOTOS_CACHE_TTL_MS + 1);
      await photoRequest(query);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it("does not cache failures", async () => {
      vi.stubGlobal("fetch", mockMediaFetch({}, false, 500));
      await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}`);

      const fetchSpy = mockMediaFetch({ photoUri: PHOTO_URI });
      vi.stubGlobal("fetch", fetchSpy);
      const res = await photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}`);
      expect(res.status).toBe(302);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
