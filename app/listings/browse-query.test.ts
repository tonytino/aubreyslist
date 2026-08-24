import { describe, expect, it, vi } from "vitest";
import { browseQueryOptions } from "./browse-query";

// Server-fn seam: the mock echoes its payload so each test can assert
// exactly what would reach the server.
vi.mock("~/server/listings/browse.fn", () => ({
  fetchBrowseListings: vi.fn(({ data }: { data: unknown }) => Promise.resolve(data)),
}));

const COORDS = { lat: 39.74, lng: -104.99 };
const AREA = { lat: 39.9, lng: -105.1 };

type BrowsePayload = {
  page: number;
  userLat?: number;
  userLng?: number;
  originLat?: number;
  originLng?: number;
  radiusMiles: number;
};

function payloadOf(options: ReturnType<typeof browseQueryOptions>): Promise<BrowsePayload> {
  // The queryFn's real signature takes a QueryFunctionContext it never reads;
  // the mock echoes the payload, so the zero-arg cast is the test's seam.
  return (options.queryFn as unknown as () => Promise<BrowsePayload>)();
}

describe("browseQueryOptions — anchor threading", () => {
  it("anchors the distance sort on the visitor's coords when no area is searched", async () => {
    const options = browseQueryOptions(
      1,
      [],
      "distance",
      COORDS,
      "",
      25,
      false,
      [],
      true,
      undefined
    );
    const payload = await payloadOf(options);
    expect(payload.userLat).toBe(COORDS.lat);
    expect(payload.userLng).toBe(COORDS.lng);
    expect(payload.originLat).toBeUndefined();
    expect(payload.originLng).toBeUndefined();
  });

  it("re-anchors ordering, labels, and radius origin on the searched spot when an area is set", async () => {
    const options = browseQueryOptions(1, [], "distance", COORDS, "", 25, false, [], true, AREA);
    const payload = await payloadOf(options);
    // The sort anchor IS the area — page 1 is the closest-to-the-spot page
    // and the server derives "0.4 mi" labels from it, not from the visitor.
    expect(payload.userLat).toBe(AREA.lat);
    expect(payload.userLng).toBe(AREA.lng);
    // The radius origin is the same spot, via the server's existing inputs.
    expect(payload.originLat).toBe(AREA.lat);
    expect(payload.originLng).toBe(AREA.lng);
  });

  it("threads the area as radius origin only, for a non-distance sort", async () => {
    const options = browseQueryOptions(1, [], "alpha", COORDS, "", 25, false, [], true, AREA);
    const payload = await payloadOf(options);
    expect(payload.userLat).toBeUndefined();
    expect(payload.userLng).toBeUndefined();
    expect(payload.originLat).toBe(AREA.lat);
    expect(payload.originLng).toBe(AREA.lng);
  });

  it("keys the cache on the effective anchor and the area, not the shadowed coords", () => {
    const withArea = browseQueryOptions(1, [], "distance", COORDS, "", 25, false, [], true, AREA);
    const otherCoords = browseQueryOptions(
      1,
      [],
      "distance",
      { lat: 40.1, lng: -105.5 },
      "",
      25,
      false,
      [],
      true,
      AREA
    );
    // With an area active, the visitor's coords no longer participate — a
    // late geolocation reading must not refetch the searched area's pages.
    expect(withArea.queryKey).toEqual(otherCoords.queryKey);
    const noArea = browseQueryOptions(
      1,
      [],
      "distance",
      COORDS,
      "",
      25,
      false,
      [],
      true,
      undefined
    );
    expect(withArea.queryKey).not.toEqual(noArea.queryKey);
  });
});
