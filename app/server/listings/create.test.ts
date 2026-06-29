import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Listing } from "~/db/schema";
import type { PlaceDetails, PlacesResult } from "~/server/places";

/**
 * Unit tests for the add-listing write logic (`runCreateListing`).
 *
 * We exercise the pure logic against mocked collaborators (no live DB, no real
 * Places call): the active intake-mode read (`getSetting`), the Places details
 * provider (`runPlaceDetails`), and the drizzle handle.
 *
 * The auth gate and per-user write rate limit (#18) live on the `createListing`
 * server-fn wrapper, not on `runCreateListing`; their own logic is covered in
 * `auth/guards.test.ts` and `rate-limit/index.test.ts`. Here we only assert the
 * wrapper wires them in the right order (auth, then limit, then the write).
 */

// --- Mocks -----------------------------------------------------------------

const getSettingMock = vi.fn();
vi.mock("~/server/settings", () => ({ getSetting: (key: string) => getSettingMock(key) }));

const runPlaceDetailsMock = vi.fn();
vi.mock("~/server/places", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/places")>();
  return {
    ...actual,
    runPlaceDetails: (input: unknown) => runPlaceDetailsMock(input),
  };
});

// Model the DB shapes `insertListing` uses:
//   db.query.listings.findFirst({ where })  — places dedup lookup
//   db.query.listings.findMany({ where })   — manual dedup candidate fetch (#25)
//   db.insert(...).values(...).onConflictDoNothing(...).returning()  — the write
let findFirstResult: Listing | undefined;
let findManyResult: Listing[] = [];
let returningResult: Listing[] = [];

const findFirstMock = vi.fn(() => Promise.resolve(findFirstResult));
const findManyMock = vi.fn((_args?: { where?: unknown }) => Promise.resolve(findManyResult));

/**
 * Collect the DB column names a drizzle predicate references (recursively walking
 * its `queryChunks`). Lets a test assert the manual-dedup candidate query is
 * scoped to both `place_id` (manual only) AND `moderation_status` (visible only,
 * #25 fix) without depending on the exact SQL string.
 */
function columnsReferenced(predicate: unknown): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (typeof record.name === "string" && "table" in record) {
        found.push(record.name);
      }
      if ("queryChunks" in record) visit(record.queryChunks);
    }
  };
  visit(predicate);
  return found;
}
const returningMock = vi.fn(() => Promise.resolve(returningResult));
const onConflictDoNothingMock = vi.fn((_args?: unknown) => ({ returning: returningMock }));
const valuesMock = vi.fn((_values?: Record<string, unknown>) => ({
  onConflictDoNothing: onConflictDoNothingMock,
}));
const insertMock = vi.fn(() => ({ values: valuesMock }));

vi.mock("~/db/client", () => ({
  getDb: () => ({
    query: { listings: { findFirst: findFirstMock, findMany: findManyMock } },
    insert: insertMock,
  }),
}));

// The `createListing` server-fn wrapper layers auth + rate limiting over the
// pure `runCreateListing` logic. We mock both so we can assert the wrapper's
// order of operations (auth gate, then per-user write limit) without cookie/DB
// plumbing; the limiter's own window logic is covered in `rate-limit/index.test.ts`.
const requireCurrentUserMock = vi.fn(() => Promise.resolve({ id: "user-1" }));
vi.mock("~/server/auth/guards", () => ({ requireCurrentUser: () => requireCurrentUserMock() }));

const enforceWriteLimitMock = vi.fn((_userId?: string) => Promise.resolve());
vi.mock("~/server/rate-limit", () => ({
  enforceWriteLimit: (userId?: string) => enforceWriteLimitMock(userId),
}));

import { createListing, createListingInputSchema, runCreateListing } from "./create";

// --- Fixtures --------------------------------------------------------------

function listingRow(overrides: Partial<Listing> = {}): Listing {
  return {
    id: "listing-1",
    placeId: "place-123",
    name: "Sweet Action",
    address: "52 Broadway, Denver, CO",
    lat: 39.7,
    lng: -104.9,
    mapsUrl: "https://maps.example/place-123",
    menuUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Listing;
}

function placeDetailsOk(): PlacesResult<PlaceDetails> {
  return {
    ok: true,
    data: {
      placeId: "place-123",
      name: "Sweet Action",
      formattedAddress: "52 Broadway, Denver, CO",
      lat: 39.7,
      lng: -104.9,
      mapsUrl: "https://maps.example/place-123",
    },
  };
}

beforeEach(() => {
  findFirstResult = undefined;
  findManyResult = [];
  returningResult = [];
  getSettingMock.mockResolvedValue("places");
  runPlaceDetailsMock.mockResolvedValue(placeDetailsOk());
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- Places mode -----------------------------------------------------------

describe("runCreateListing — places mode", () => {
  it("resolves Place details server-side and inserts a new listing", async () => {
    const created = listingRow();
    returningResult = [created];

    const result = await runCreateListing({ mode: "places", placeId: "place-123" });

    expect(result).toEqual({ listing: created, created: true });
    // The submitted placeId drives the details lookup (client never sends name/coords).
    expect(runPlaceDetailsMock).toHaveBeenCalledWith({ placeId: "place-123" });
    // Resolved canonical fields are what we insert.
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        placeId: "place-123",
        name: "Sweet Action",
        address: "52 Broadway, Denver, CO",
        lat: 39.7,
        lng: -104.9,
      })
    );
  });

  it("routes to the existing listing on a duplicate Place ID (no error)", async () => {
    const existing = listingRow({ id: "existing-1" });
    findFirstResult = existing;

    const result = await runCreateListing({ mode: "places", placeId: "place-123" });

    expect(result).toEqual({ listing: existing, created: false });
    // Dedup short-circuits before any insert.
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("treats a concurrent-insert conflict as 'already listed' and re-reads the row", async () => {
    // No row on the first dedup read, but the insert returns nothing (conflict);
    // the post-insert re-read finds the row a concurrent request created.
    const winner = listingRow({ id: "winner-1" });
    findFirstMock
      .mockResolvedValueOnce(undefined) // pre-insert dedup miss
      .mockResolvedValueOnce(winner); // post-conflict re-read
    returningResult = [];

    const result = await runCreateListing({ mode: "places", placeId: "place-123" });

    expect(result).toEqual({ listing: winner, created: false });
    expect(onConflictDoNothingMock).toHaveBeenCalledWith({ target: expect.anything() });
  });

  it("rejects a places submission while intake is in manual mode", async () => {
    getSettingMock.mockResolvedValue("manual");

    await expect(runCreateListing({ mode: "places", placeId: "place-123" })).rejects.toThrow(
      /manual/i
    );
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("surfaces the provider's friendly message when details fail", async () => {
    runPlaceDetailsMock.mockResolvedValue({
      ok: false,
      reason: "upstream_error",
      message: "Place details came back incomplete. Please try a different result.",
    });

    await expect(runCreateListing({ mode: "places", placeId: "place-123" })).rejects.toThrow(
      /came back incomplete/
    );
  });
});

// --- Manual mode -----------------------------------------------------------

describe("runCreateListing — manual mode", () => {
  beforeEach(() => {
    getSettingMock.mockResolvedValue("manual");
  });

  it("inserts the submitted fields with placeId null and a search Maps URL", async () => {
    const created = listingRow({ placeId: null });
    returningResult = [created];

    const result = await runCreateListing({
      mode: "manual",
      name: "Corner Cafe",
      address: "1 Main St, Denver",
      lat: 39.74,
      lng: -104.99,
      menuUrl: "https://corner.example/menu",
    });

    expect(result).toEqual({ listing: created, created: true });
    // No Places call in manual mode.
    expect(runPlaceDetailsMock).not.toHaveBeenCalled();
    // Manual entries never carry a Place ID, so they never collide on the unique index.
    const inserted = valuesMock.mock.calls[0]?.[0];
    expect(inserted?.placeId).toBeNull();
    expect(inserted?.name).toBe("Corner Cafe");
    expect(inserted?.menuUrl).toBe("https://corner.example/menu");
    expect(String(inserted?.mapsUrl)).toContain("https://www.google.com/maps/search/");
  });

  it("does not use the Place-ID dedup lookup for a manual entry (placeId is null)", async () => {
    returningResult = [listingRow({ placeId: null })];

    await runCreateListing({
      mode: "manual",
      name: "Corner Cafe",
      address: "1 Main St, Denver",
      lat: 39.74,
      lng: -104.99,
    });

    // Manual entries never carry a Place ID, so they never hit the Place-ID
    // `findFirst` dedup lookup; they use the name+address `findMany` candidate
    // fetch instead (#25).
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });

  it("scopes the dedup candidate query to visible manual rows only (#25)", async () => {
    returningResult = [listingRow({ placeId: null })];

    await runCreateListing({
      mode: "manual",
      name: "Corner Cafe",
      address: "1 Main St, Denver",
      lat: 39.74,
      lng: -104.99,
    });

    // The candidate `where` must AND `place_id IS NULL` with
    // `moderation_status = 'visible'` — a hidden/removed listing must never be a
    // dedup candidate (it would wrongly block a re-add and point at a row the
    // user can't see → 404). We assert both columns are referenced rather than
    // pin the exact SQL string.
    const where = findManyMock.mock.calls[0]?.[0]?.where;
    const cols = columnsReferenced(where);
    expect(cols).toContain("place_id");
    expect(cols).toContain("moderation_status");
  });

  it("does NOT block a re-add when the only match is a hidden/removed listing (#25)", async () => {
    // In production the `moderation_status = 'visible'` filter excludes the
    // hidden/removed row at the DB, so the candidate set comes back empty and the
    // new manual add proceeds. We model that filtered result here.
    findManyResult = [];
    const created = listingRow({ id: "readd-1", placeId: null });
    returningResult = [created];

    const result = await runCreateListing({
      mode: "manual",
      name: "Corner Cafe",
      address: "1 Main St, Denver, CO",
      lat: 39.74,
      lng: -104.99,
    });

    expect(result).toEqual({ listing: created, created: true });
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("blocks a normalized name+address duplicate with a structured error (#25)", async () => {
    const existing = listingRow({
      id: "existing-7",
      placeId: null,
      // Differs only by case / punctuation / accent / spacing.
      name: "  CÓRNER  café ",
      address: "1 main st., denver co",
    });
    findManyResult = [existing];

    const promise = runCreateListing({
      mode: "manual",
      name: "Corner Cafe",
      address: "1 Main St Denver CO",
      lat: 39.74,
      lng: -104.99,
    });

    await expect(promise).rejects.toMatchObject({
      name: "DuplicateListingError",
      existingListingId: "existing-7",
      existingListingName: "  CÓRNER  café ",
    });
    // A blocked duplicate never inserts.
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("inserts when an existing manual listing has a different address (chain branch)", async () => {
    findManyResult = [
      listingRow({ id: "branch-1", placeId: null, address: "999 Other Ave, Boulder, CO" }),
    ];
    const created = listingRow({ id: "new-1", placeId: null });
    returningResult = [created];

    const result = await runCreateListing({
      mode: "manual",
      name: "Corner Cafe",
      address: "1 Main St, Denver, CO",
      lat: 39.74,
      lng: -104.99,
    });

    expect(result).toEqual({ listing: created, created: true });
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a manual submission while intake is in places mode", async () => {
    getSettingMock.mockResolvedValue("places");

    await expect(
      runCreateListing({
        mode: "manual",
        name: "Corner Cafe",
        address: "1 Main St, Denver",
        lat: 39.74,
        lng: -104.99,
      })
    ).rejects.toThrow(/places/i);
  });
});

// --- menuUrl scheme allowlist (#90) ----------------------------------------

describe("createListingInputSchema — menuUrl scheme allowlist (#90)", () => {
  const base = { mode: "places" as const, placeId: "place-123" };

  it("accepts an https menu URL", () => {
    const result = createListingInputSchema.safeParse({
      ...base,
      menuUrl: "https://corner.example/menu",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.menuUrl).toBe("https://corner.example/menu");
  });

  it("accepts an http menu URL", () => {
    const result = createListingInputSchema.safeParse({
      ...base,
      menuUrl: "http://corner.example",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a javascript: scheme menu URL", () => {
    const result = createListingInputSchema.safeParse({
      ...base,
      menuUrl: "javascript:alert(document.cookie)",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a data: scheme menu URL", () => {
    const result = createListingInputSchema.safeParse({
      ...base,
      menuUrl: "data:text/html,<script>alert(1)</script>",
    });
    expect(result.success).toBe(false);
  });

  it("still allows an empty string (blank field normalises to undefined)", () => {
    const result = createListingInputSchema.safeParse({ ...base, menuUrl: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.menuUrl).toBeUndefined();
  });
});

// --- createListing server-fn wrapper (auth + rate limit) -------------------

describe("createListing — write rate limiting (#18)", () => {
  it("enforces the per-user write limit before the write, on the authed user", async () => {
    returningResult = [listingRow()];

    await createListing({ data: { mode: "places", placeId: "place-123" } });

    // Metered on the authenticated user's id, after the auth gate resolved them,
    // and before any DB write (the insert ran, so the limiter let it through).
    expect(enforceWriteLimitMock).toHaveBeenCalledTimes(1);
    expect(enforceWriteLimitMock).toHaveBeenCalledWith("user-1");
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("does not write when the rate limit is exceeded (429)", async () => {
    const tooFast = new HTTPException(429, { message: "too fast" });
    enforceWriteLimitMock.mockRejectedValueOnce(tooFast);

    await expect(createListing({ data: { mode: "places", placeId: "place-123" } })).rejects.toBe(
      tooFast
    );
    // The limiter short-circuits before any DB work.
    expect(insertMock).not.toHaveBeenCalled();
  });
});
