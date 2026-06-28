import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks -----------------------------------------------------------------
// We mock the two server-only dependencies (the env accessor and the DB client)
// plus global `fetch`, so the provider's logic is exercised without a live key,
// a real database, or any real network call to Google.

const getEnvMock = vi.fn();
vi.mock("~/env", () => ({ getEnv: () => getEnvMock() }));

// The intake-mode read goes through getDb().select()...where().limit(). We model
// that chain and let each test set the row it returns.
let intakeRows: Array<{ value: string }> = [];
const limitMock = vi.fn(() => Promise.resolve(intakeRows));
const whereMock = vi.fn(() => ({ limit: limitMock }));
const fromMock = vi.fn(() => ({ where: whereMock }));
const selectMock = vi.fn(() => ({ from: fromMock }));
vi.mock("~/db/client", () => ({ getDb: () => ({ select: selectMock }) }));

import { buildMapsUrl, runAutocomplete, runPlaceDetails } from "./places";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "ERR",
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  intakeRows = []; // default: no row -> defaults to "places"
  getEnvMock.mockReturnValue({ GOOGLE_PLACES_API_KEY: "test-key" });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("buildMapsUrl", () => {
  it("builds a place_id deep-link", () => {
    expect(buildMapsUrl("ChIJ_abc")).toBe("https://www.google.com/maps/place/?q=place_id:ChIJ_abc");
  });
});

describe("runAutocomplete", () => {
  it("returns predictions on success", async () => {
    const fetchSpy = mockFetchOnce({
      suggestions: [
        { placePrediction: { placeId: "place-1", text: { text: "Cafe One, Denver" } } },
        { placePrediction: { placeId: "place-2", text: { text: "Cafe Two, Denver" } } },
      ],
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runAutocomplete({ query: "cafe" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toEqual([
      { placeId: "place-1", description: "Cafe One, Denver" },
      { placeId: "place-2", description: "Cafe Two, Denver" },
    ]);

    // Hits the Places API (New) autocomplete endpoint with the key in a header,
    // never in the query string.
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(url).not.toContain("test-key");
  });

  it("short-circuits with intake_disabled when mode is manual (no fetch)", async () => {
    intakeRows = [{ value: "manual" }];
    const fetchSpy = mockFetchOnce({});
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runAutocomplete({ query: "cafe" });

    expect(result).toMatchObject({ ok: false, reason: "intake_disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns missing_key when the API key is absent (no fetch)", async () => {
    getEnvMock.mockReturnValue({ GOOGLE_PLACES_API_KEY: undefined });
    const fetchSpy = mockFetchOnce({});
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runAutocomplete({ query: "cafe" });

    expect(result).toMatchObject({ ok: false, reason: "missing_key" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps an upstream non-OK response to a friendly upstream_error", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ error: "boom" }, false, 503));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runAutocomplete({ query: "cafe" });

    expect(result).toMatchObject({ ok: false, reason: "upstream_error" });
    if (!result.ok) expect(result.message).not.toContain("boom");
  });

  it("maps a network failure to network_error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runAutocomplete({ query: "cafe" });

    expect(result).toMatchObject({ ok: false, reason: "network_error" });
  });
});

describe("runPlaceDetails", () => {
  it("returns structured details including Place ID and Maps URL", async () => {
    const fetchSpy = mockFetchOnce({
      id: "ChIJ_target",
      displayName: { text: "Aubrey's Cafe" },
      formattedAddress: "123 Main St, Denver, CO",
      location: { latitude: 39.7392, longitude: -104.9903 },
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runPlaceDetails({ placeId: "ChIJ_target" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toEqual({
      placeId: "ChIJ_target",
      name: "Aubrey's Cafe",
      formattedAddress: "123 Main St, Denver, CO",
      lat: 39.7392,
      lng: -104.9903,
      mapsUrl: "https://www.google.com/maps/place/?q=place_id:ChIJ_target",
    });

    // Place ID is the dedup key and the Maps deep-link is derived from it.
    expect(result.data.placeId).toBe("ChIJ_target");
    expect(result.data.mapsUrl).toContain("place_id:ChIJ_target");

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://places.googleapis.com/v1/places/ChIJ_target");
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(init.headers["X-Goog-FieldMask"]).toContain("location");
  });

  it("short-circuits with intake_disabled when mode is manual (no fetch)", async () => {
    intakeRows = [{ value: "manual" }];
    const fetchSpy = mockFetchOnce({});
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runPlaceDetails({ placeId: "ChIJ_target" });

    expect(result).toMatchObject({ ok: false, reason: "intake_disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns missing_key when the API key is absent (no fetch)", async () => {
    getEnvMock.mockReturnValue({ GOOGLE_PLACES_API_KEY: undefined });
    const fetchSpy = mockFetchOnce({});
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runPlaceDetails({ placeId: "ChIJ_target" });

    expect(result).toMatchObject({ ok: false, reason: "missing_key" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats incomplete details (missing location) as upstream_error", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ id: "ChIJ_target", formattedAddress: "123 Main St" }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runPlaceDetails({ placeId: "ChIJ_target" });

    expect(result).toMatchObject({ ok: false, reason: "upstream_error" });
  });
});
