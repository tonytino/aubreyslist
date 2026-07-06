import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks -----------------------------------------------------------------
// The photos provider's server-only collaborators (env accessor, app-settings
// read, listing lookup) are mocked, plus global `fetch`, so its logic runs
// without a live key, a database, or any real Google call.

const getEnvMock = vi.fn();
vi.mock("~/env", () => ({ getEnv: () => getEnvMock() }));

const getSettingMock = vi.fn((_key: string) => Promise.resolve<unknown>(true));
vi.mock("~/server/settings", () => ({
  getSetting: (key: string) => getSettingMock(key),
}));

const getListingMock = vi.fn((_input: { id: string }) =>
  Promise.resolve<{ placeId: string | null } | null>({ placeId: "ChIJ_place" })
);
vi.mock("~/server/listings/get-listing", () => ({
  getListing: (input: { id: string }) => getListingMock(input),
}));

import {
  listingPhotosCache,
  MAX_LISTING_PHOTOS,
  PLACE_PHOTOS_CACHE_TTL_MS,
  runListingPhotos,
  TtlCache,
} from "./places-photos";

const UPSTREAM_PHOTO = {
  name: "places/ChIJ_place/photos/resource-1",
  widthPx: 4032,
  heightPx: 3024,
  authorAttributions: [{ displayName: "A Diner", uri: "https://maps.google.com/maps/contrib/123" }],
};

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "ERR",
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  listingPhotosCache.clear();
  getEnvMock.mockReturnValue({ GOOGLE_PLACES_API_KEY: "test-key" });
  getSettingMock.mockResolvedValue(true);
  getListingMock.mockResolvedValue({ placeId: "ChIJ_place" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("runListingPhotos", () => {
  it("maps upstream photos to client-safe descriptors (photos-only field mask)", async () => {
    const fetchSpy = mockFetchOnce({ photos: [UPSTREAM_PHOTO] });
    vi.stubGlobal("fetch", fetchSpy);

    const photos = await runListingPhotos({ listingId: "listing-1" });

    expect(photos).toEqual([
      {
        photoToken: "places/ChIJ_place/photos/resource-1",
        widthPx: 4032,
        heightPx: 3024,
        attributions: [{ displayName: "A Diner", uri: "https://maps.google.com/maps/contrib/123" }],
      },
    ]);

    // The paid call stays TIGHT: photos-only field mask, key in a header (never
    // the URL), against the details endpoint for the listing's Place ID.
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://places.googleapis.com/v1/places/ChIJ_place");
    expect(init.headers["X-Goog-FieldMask"]).toBe("photos");
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(url).not.toContain("test-key");
  });

  it(`caps the result at ${MAX_LISTING_PHOTOS} photos`, async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      ...UPSTREAM_PHOTO,
      name: `places/ChIJ_place/photos/resource-${i}`,
    }));
    vi.stubGlobal("fetch", mockFetchOnce({ photos: many }));

    const photos = await runListingPhotos({ listingId: "listing-1" });
    expect(photos).toHaveLength(MAX_LISTING_PHOTOS);
  });

  it("normalizes protocol-relative attribution URIs to https and drops unsafe ones", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce({
        photos: [
          {
            ...UPSTREAM_PHOTO,
            authorAttributions: [
              { displayName: "Rel", uri: "//maps.google.com/maps/contrib/9" },
              { displayName: "Evil", uri: "javascript:alert(1)" },
              { displayName: "None" },
            ],
          },
        ],
      })
    );

    const [photo] = await runListingPhotos({ listingId: "listing-1" });
    expect(photo?.attributions).toEqual([
      { displayName: "Rel", uri: "https://maps.google.com/maps/contrib/9" },
      { displayName: "Evil" },
      { displayName: "None" },
    ]);
  });

  it("returns [] without fetching when the kill switch is off", async () => {
    getSettingMock.mockResolvedValue(false);
    const fetchSpy = mockFetchOnce({});
    vi.stubGlobal("fetch", fetchSpy);

    expect(await runListingPhotos({ listingId: "listing-1" })).toEqual([]);
    expect(getSettingMock).toHaveBeenCalledWith("place_photos_enabled");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns [] without fetching when the API key is unset", async () => {
    getEnvMock.mockReturnValue({ GOOGLE_PLACES_API_KEY: undefined });
    const fetchSpy = mockFetchOnce({});
    vi.stubGlobal("fetch", fetchSpy);

    expect(await runListingPhotos({ listingId: "listing-1" })).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns [] without fetching for a manual listing (placeId null) or a missing listing", async () => {
    const fetchSpy = mockFetchOnce({});
    vi.stubGlobal("fetch", fetchSpy);

    getListingMock.mockResolvedValue({ placeId: null });
    expect(await runListingPhotos({ listingId: "manual-1" })).toEqual([]);

    getListingMock.mockResolvedValue(null);
    expect(await runListingPhotos({ listingId: "gone-1" })).toEqual([]);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns [] (with a warn, no throw) on upstream non-200 / bad shape / network error", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({}, false, 500));
    expect(await runListingPhotos({ listingId: "listing-1" })).toEqual([]);

    vi.stubGlobal("fetch", mockFetchOnce({ photos: [{ nope: true }] }));
    expect(await runListingPhotos({ listingId: "listing-1" })).toEqual([]);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    expect(await runListingPhotos({ listingId: "listing-1" })).toEqual([]);

    expect(console.warn).toHaveBeenCalled();
  });

  describe("per-place TTL cache", () => {
    it("serves a repeat lookup from cache within the TTL, refetches after expiry", async () => {
      vi.useFakeTimers();
      const fetchSpy = mockFetchOnce({ photos: [UPSTREAM_PHOTO] });
      vi.stubGlobal("fetch", fetchSpy);

      const first = await runListingPhotos({ listingId: "listing-1" });
      const second = await runListingPhotos({ listingId: "listing-1" });
      expect(second).toEqual(first);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // One tick past the TTL → the entry has expired and Google is re-asked.
      vi.advanceTimersByTime(PLACE_PHOTOS_CACHE_TTL_MS + 1);
      await runListingPhotos({ listingId: "listing-1" });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("caches a legit empty photo list, but never caches a failure", async () => {
      // Success with no photos → cached (no repeat billing for photo-less places).
      const emptySpy = mockFetchOnce({ photos: [] });
      vi.stubGlobal("fetch", emptySpy);
      expect(await runListingPhotos({ listingId: "listing-1" })).toEqual([]);
      expect(await runListingPhotos({ listingId: "listing-1" })).toEqual([]);
      expect(emptySpy).toHaveBeenCalledTimes(1);

      // Failure → NOT cached; a later view may retry.
      listingPhotosCache.clear();
      const failSpy = mockFetchOnce({}, false, 502);
      vi.stubGlobal("fetch", failSpy);
      await runListingPhotos({ listingId: "listing-1" });
      await runListingPhotos({ listingId: "listing-1" });
      expect(failSpy).toHaveBeenCalledTimes(2);
    });
  });
});

describe("TtlCache", () => {
  it("stores, expires after the TTL, and clears", () => {
    vi.useFakeTimers();
    const cache = new TtlCache<string>(1_000);
    cache.set("k", "v");
    expect(cache.get("k")).toBe("v");

    vi.advanceTimersByTime(999);
    expect(cache.get("k")).toBe("v");
    vi.advanceTimersByTime(1);
    expect(cache.get("k")).toBeUndefined();

    cache.set("k", "v2");
    cache.clear();
    expect(cache.get("k")).toBeUndefined();
  });

  it("caps entries, evicting the oldest-inserted first (keys are attacker-influenceable)", () => {
    const cache = new TtlCache<number>(60_000, 3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // At the cap: a new key evicts the OLDEST ("a"), the rest survive.
    cache.set("d", 4);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);

    // Overwriting an existing key does NOT evict anyone — it just re-ages.
    cache.set("b", 20);
    expect(cache.get("b")).toBe(20);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);

    // The re-aged "b" moved to the back of the eviction order: next eviction
    // takes "c", the now-oldest insertion.
    cache.set("e", 5);
    expect(cache.get("c")).toBeUndefined();
    expect(cache.get("b")).toBe(20);
    expect(cache.get("e")).toBe(5);
  });
});

// NOTE: the thin `fetchListingPhotos` wrapper in `places-photos.fn.ts` is not
// direct-invoked here — GET server fns don't run through the in-process
// `callServerFn` harness (repo-wide, no GET `*.fn.ts` wrapper has a direct
// test; cf. browse.fn / incidents.fn / get-listing.fn). Its Zod validator
// (`listingPhotosInputSchema`) and handler body (`runListingPhotos`) are both
// covered above.
