import { describe, expect, it } from "vitest";
import { SEED_LISTINGS, type SeededListing } from "./seed-data";

/**
 * ADR-014 artifact invariant: the committed seed bake must never carry a
 * captured Google rating.
 *
 * This guards the artifact ADR-014 actually names — `SEED_LISTINGS`, parsed
 * unchecked (`JSON.parse(...) as SeededListing[]`) from the committed
 * `seed-listings.generated.json` — not just the emitter.
 * `refresh-seed-data.test.ts` pins that a fresh refresh never bakes rating
 * fields; it says nothing about the file already sitting in the repo, so a
 * bad merge, a revert, or a hand-edit that reinstates `googleRating` /
 * `googleRatingCount` would pass every other test.
 *
 * Any key outside the documented `SeededListing` field set fails, so a capture
 * of hours, phone, photos or reviews is caught here too.
 */

/**
 * Keyed by `SeededListing` so drift is a compile error in both directions: a new
 * field on the interface fails until it is allowed here (the ADR-014 checkpoint),
 * and a removed one fails until it is dropped, so the allowlist can never go
 * silently stale and permissive.
 */
const ALLOWED: Record<keyof Required<SeededListing>, true> = {
  placeId: true,
  name: true,
  address: true,
  lat: true,
  lng: true,
  suggestedAttributes: true,
  menuUrl: true,
  googleMapsUri: true,
};

const ALLOWED_KEYS = new Set(Object.keys(ALLOWED));

describe("SEED_LISTINGS (ADR-014 artifact invariant)", () => {
  it("is non-empty (the bake has actually run)", () => {
    expect(SEED_LISTINGS.length).toBeGreaterThan(0);
  });

  it("never carries a key outside the documented SeededListing field set", () => {
    const strayKeys = new Set<string>();
    for (const listing of SEED_LISTINGS) {
      for (const key of Object.keys(listing)) {
        if (!ALLOWED_KEYS.has(key)) strayKeys.add(key);
      }
    }

    expect([...strayKeys].sort()).toEqual([]);
  });
});
