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

// The BATCH path (AUB-219) queries the DB directly (no N+1 via `getListing` per
// id) — model the exact chain it uses: `select({...}).from(listings).where(...)`.
// The predicate itself is built with the REAL `drizzle-orm` `and`/`eq`/`inArray`
// (unmocked — they just build a SQL AST, no DB touched), so only the terminal
// `where(...)` needs mocking to resolve canned rows.
const selectListingsMock = vi.fn(() =>
  Promise.resolve<Array<{ id: string; placeId: string | null }>>([])
);
vi.mock("~/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => selectListingsMock(),
      }),
    }),
  }),
}));

import {
  BATCH_PHOTO_CONCURRENCY,
  getPhotosForListings,
  listingIdsInputSchema,
  listingPhotosCache,
  MAX_BATCH_LISTING_IDS,
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
  selectListingsMock.mockResolvedValue([]);
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

describe("listingIdsInputSchema", () => {
  it("accepts a non-empty batch up to the cap", () => {
    const ids = Array.from({ length: MAX_BATCH_LISTING_IDS }, (_, i) => `listing-${i}`);
    expect(listingIdsInputSchema.safeParse({ listingIds: ids }).success).toBe(true);
  });

  it(`rejects a batch over the ${MAX_BATCH_LISTING_IDS}-id cap`, () => {
    const ids = Array.from({ length: MAX_BATCH_LISTING_IDS + 1 }, (_, i) => `listing-${i}`);
    expect(listingIdsInputSchema.safeParse({ listingIds: ids }).success).toBe(false);
  });

  it("rejects an empty batch", () => {
    expect(listingIdsInputSchema.safeParse({ listingIds: [] }).success).toBe(false);
  });
});

describe("getPhotosForListings (browse batch, AUB-219)", () => {
  it("returns {} without a DB read or fetch when the kill switch is off", async () => {
    getSettingMock.mockResolvedValue(false);
    const fetchSpy = mockFetchOnce({});
    vi.stubGlobal("fetch", fetchSpy);

    const result = await getPhotosForListings({ listingIds: ["listing-1"] });

    expect(result).toEqual({});
    expect(selectListingsMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns {} without a DB read or fetch when the API key is unset", async () => {
    getEnvMock.mockReturnValue({ GOOGLE_PLACES_API_KEY: undefined });
    const fetchSpy = mockFetchOnce({});
    vi.stubGlobal("fetch", fetchSpy);

    const result = await getPhotosForListings({ listingIds: ["listing-1"] });

    expect(result).toEqual({});
    expect(selectListingsMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps each listing with a Place ID to its FIRST photo and omits manual listings", async () => {
    selectListingsMock.mockResolvedValue([
      { id: "listing-1", placeId: "ChIJ_one" },
      { id: "listing-2", placeId: "ChIJ_two" },
      { id: "listing-3", placeId: null }, // manual entry — no Place ID
    ]);
    const fetchSpy = vi.fn((url: string) => {
      const placeId = url.includes("ChIJ_one") ? "ChIJ_one" : "ChIJ_two";
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () =>
          Promise.resolve({
            photos: [
              { ...UPSTREAM_PHOTO, name: `places/${placeId}/photos/resource-1` },
              { ...UPSTREAM_PHOTO, name: `places/${placeId}/photos/resource-2` },
            ],
          }),
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await getPhotosForListings({
      listingIds: ["listing-1", "listing-2", "listing-3"],
    });

    expect(Object.keys(result).sort()).toEqual(["listing-1", "listing-2"]);
    // ONE photo per listing (the FIRST), not the full up-to-MAX_LISTING_PHOTOS list.
    expect(result["listing-1"]?.photoToken).toBe("places/ChIJ_one/photos/resource-1");
    expect(result["listing-2"]?.photoToken).toBe("places/ChIJ_two/photos/resource-1");
    expect(result["listing-3"]).toBeUndefined();
  });

  it("shares the SAME per-Place-ID cache as the hero path — a place warmed by runListingPhotos costs zero calls here", async () => {
    const fetchSpy = mockFetchOnce({ photos: [UPSTREAM_PHOTO] });
    vi.stubGlobal("fetch", fetchSpy);

    // Warm the cache via the hero (single-listing) path.
    getListingMock.mockResolvedValue({ placeId: "ChIJ_place" });
    await runListingPhotos({ listingId: "hero-listing" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // A browse listing mapping to the SAME Place ID reuses the cache entry.
    selectListingsMock.mockResolvedValue([{ id: "browse-listing", placeId: "ChIJ_place" }]);
    const result = await getPhotosForListings({ listingIds: ["browse-listing"] });

    expect(fetchSpy).toHaveBeenCalledTimes(1); // no new upstream call
    expect(result["browse-listing"]?.photoToken).toBe(UPSTREAM_PHOTO.name);
  });

  it("dedupes two listings that map to the SAME Place ID into one upstream call", async () => {
    selectListingsMock.mockResolvedValue([
      { id: "listing-1", placeId: "ChIJ_shared" },
      { id: "listing-2", placeId: "ChIJ_shared" },
    ]);
    const fetchSpy = mockFetchOnce({
      photos: [{ ...UPSTREAM_PHOTO, name: "places/ChIJ_shared/photos/resource-1" }],
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await getPhotosForListings({ listingIds: ["listing-1", "listing-2"] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result["listing-1"]?.photoToken).toBe(result["listing-2"]?.photoToken);
  });

  it("isolates a per-place failure: one place 500s, the other listings still resolve their photo", async () => {
    selectListingsMock.mockResolvedValue([
      { id: "listing-ok", placeId: "ChIJ_ok" },
      { id: "listing-fails", placeId: "ChIJ_fails" },
    ]);
    const fetchSpy = vi.fn((url: string) => {
      if (url.includes("ChIJ_fails")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: "ERR",
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve({ photos: [UPSTREAM_PHOTO] }),
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await getPhotosForListings({ listingIds: ["listing-ok", "listing-fails"] });

    expect(result["listing-ok"]?.photoToken).toBe(UPSTREAM_PHOTO.name);
    expect(result["listing-fails"]).toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it("degrades the WHOLE batch to {} (never throws) when the DB lookup itself fails", async () => {
    selectListingsMock.mockRejectedValue(new Error("connection reset"));
    const fetchSpy = mockFetchOnce({});
    vi.stubGlobal("fetch", fetchSpy);

    const result = await getPhotosForListings({ listingIds: ["listing-1"] });

    expect(result).toEqual({});
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it(`fetches upstream photos with at most ${BATCH_PHOTO_CONCURRENCY} calls in flight on a cold cache`, async () => {
    const totalPlaces = BATCH_PHOTO_CONCURRENCY + 2;
    const listingIds = Array.from({ length: totalPlaces }, (_, i) => `listing-${i}`);
    selectListingsMock.mockResolvedValue(listingIds.map((id, i) => ({ id, placeId: `ChIJ_${i}` })));

    // Each fetch call parks on a deferred promise until the test explicitly
    // resolves it, so we can observe exactly how many are in flight at once.
    // Real (non-fake) timers/microtasks throughout — `flushMicrotasks` below
    // just gives the worker-pool's await chain enough ticks to progress.
    const pending: Array<() => void> = [];
    const fetchSpy = vi.fn(
      () =>
        new Promise((resolve) => {
          pending.push(() =>
            resolve({
              ok: true,
              status: 200,
              statusText: "OK",
              json: () => Promise.resolve({ photos: [UPSTREAM_PHOTO] }),
            })
          );
        })
    );
    vi.stubGlobal("fetch", fetchSpy);

    async function flushMicrotasks(ticks = 10) {
      for (let i = 0; i < ticks; i += 1) {
        await Promise.resolve();
      }
    }

    const resultPromise = getPhotosForListings({ listingIds });
    await flushMicrotasks();

    // The worker pool issues at most BATCH_PHOTO_CONCURRENCY calls before any
    // of them can resolve — it plateaus there since every worker is blocked
    // awaiting its own in-flight fetch, proving the concurrency cap.
    expect(fetchSpy).toHaveBeenCalledTimes(BATCH_PHOTO_CONCURRENCY);
    expect(pending).toHaveLength(BATCH_PHOTO_CONCURRENCY);

    // Settling one frees exactly one worker to pick up the next queued place —
    // do this for each of the places beyond the initial concurrency batch.
    const extra = totalPlaces - BATCH_PHOTO_CONCURRENCY;
    for (let i = 0; i < extra; i += 1) {
      pending.shift()?.();
      await flushMicrotasks();
    }
    expect(fetchSpy).toHaveBeenCalledTimes(totalPlaces); // every place asked for exactly once

    // Resolve whatever's left (workers whose next loop iteration finds no more
    // items) so the outer call can settle.
    for (const settle of pending.splice(0)) settle();

    const result = await resultPromise;
    expect(Object.keys(result)).toHaveLength(totalPlaces);
    expect(fetchSpy).toHaveBeenCalledTimes(totalPlaces);
  });
});

// NOTE: the thin `fetchListingPhotos`/`fetchBrowsePhotos` wrappers in
// `places-photos.fn.ts` are not direct-invoked here — GET server fns don't run
// through the in-process `callServerFn` harness (repo-wide, no GET `*.fn.ts`
// wrapper has a direct test; cf. browse.fn / incidents.fn / get-listing.fn).
// Their Zod validators (`listingPhotosInputSchema`, `listingIdsInputSchema`)
// and handler bodies (`runListingPhotos`, `getPhotosForListings`) are both
// covered above.
