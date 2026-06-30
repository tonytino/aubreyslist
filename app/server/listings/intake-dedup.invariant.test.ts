import { describe, expect, it } from "vitest";
import type { Listing } from "~/db/schema";
import { createListingInputSchema } from "~/listings/create-input";
import { findDuplicateListing, normalizeForDedup } from "~/server/listings/dedup";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * CANONICAL TRUST-MODEL INVARIANT SUITE — ADR-008 intake/dedup (issues #178/#185)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * DO NOT WEAKEN. This is the ADR-008 half of the trust-invariant suite (see
 * `app/trust/trust-model.invariant.test.ts` for ADR-007). It pins:
 *
 *   - Place ID is the dedup key: two intakes for the SAME place resolve to ONE
 *     listing. The DB-level UNIQUE(place_id) is the authoritative enforcement and
 *     is pinned in `tests/integration/trust-model.invariant.test.ts` (DB-gated).
 *     Here we pin the pure manual-entry safeguard that closes the gap the unique
 *     index can't (manual rows carry place_id NULL → distinct to Postgres).
 *   - The manual-entry fallback path is REACHABLE, not dead code (ADR-008: "the
 *     manual form must always work … it is the safety net, not dead code"): its
 *     validator accepts a well-formed manual submission and the dedup safeguard
 *     it feeds blocks a free-typed re-add of the same place.
 *
 * Pure-logic level (no DB): exercises `normalizeForDedup` / `findDuplicateListing`
 * (the manual safeguard) and `createListingInputSchema` (the always-present
 * manual-entry validation). `create.test.ts` covers how `runCreateListing` wires
 * these into the intake path with a mocked DB.
 */

function listingRow(overrides: Partial<Listing> = {}): Listing {
  return {
    id: "listing-1",
    placeId: null,
    name: "Corner Cafe",
    address: "1 Main St, Denver, CO",
    lat: 39.7,
    lng: -104.9,
    mapsUrl: "https://maps.example/1",
    menuUrl: null,
    moderationStatus: "visible",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Listing;
}

// ───────────────────────────────────────────────────────────────────────────
// INVARIANT 5a — manual dedup: the same free-typed place resolves to ONE listing
// (the safeguard that stands in for UNIQUE(place_id) when place_id is NULL).
// ───────────────────────────────────────────────────────────────────────────

describe("INVARIANT 5 — manual intake dedups the same place to one listing", () => {
  it("matches the same place across case / punctuation / accent / spacing noise", () => {
    // Property-style: every cosmetic re-typing of the SAME name+address must
    // collapse to the existing listing — no second row for one real restaurant.
    const existing = listingRow({ name: "Café Olé", address: "12 N. 1st St." });
    const sameNameVariants = ["Café Olé", "cafe ole", "  CAFE   OLE  ", "Café Olé!!!"];
    const sameAddressVariants = ["12 N. 1st St.", "12 n 1st st", "12  N.  1st  St"];

    for (const name of sameNameVariants) {
      for (const address of sameAddressVariants) {
        expect(findDuplicateListing({ name, address }, [existing])).toBe(existing);
      }
    }
  });

  it("treats a DIFFERENT name OR a different address as a distinct place (no false merge)", () => {
    // The dedup key must not over-merge: a different name, or the same name at a
    // different address (a second branch of a chain), is its own listing.
    const existing = listingRow({ name: "Corner Cafe", address: "1 Main St, Denver, CO" });
    expect(
      findDuplicateListing({ name: "Corner Bistro", address: "1 Main St, Denver, CO" }, [existing])
    ).toBeNull();
    expect(
      findDuplicateListing({ name: "Corner Cafe", address: "2 Main St, Denver, CO" }, [existing])
    ).toBeNull();
  });

  it("normalizeForDedup is deterministic and idempotent (a stable dedup key)", () => {
    // The dedup key derivation must be stable: normalizing twice changes nothing,
    // so the same place always keys the same way.
    for (const value of ["Joe's Diner #2", "  ÀÉÎ  Bistro ", "THE—Spot", "a & b grill"]) {
      const once = normalizeForDedup(value);
      expect(normalizeForDedup(once)).toBe(once);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// INVARIANT 5b — the manual-entry fallback is REACHABLE (not dead code): its
// validator accepts well-formed manual input and rejects malformed input.
// ───────────────────────────────────────────────────────────────────────────

describe("INVARIANT 5 — the manual-entry fallback path is reachable, not dead code", () => {
  it("accepts a well-formed manual submission (the always-present safety net)", () => {
    const result = createListingInputSchema.safeParse({
      mode: "manual",
      name: "Corner Cafe",
      address: "1 Main St, Denver, CO",
      lat: 39.7,
      lng: -104.9,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("manual");
    }
  });

  it("requires the canonical fields in manual mode (name/address/coords)", () => {
    // A blank name or out-of-range coordinate must be rejected — the fallback is
    // a real validated path, not a rubber stamp.
    expect(
      createListingInputSchema.safeParse({
        mode: "manual",
        name: "  ",
        address: "1 Main St",
        lat: 0,
        lng: 0,
      }).success
    ).toBe(false);
    expect(
      createListingInputSchema.safeParse({
        mode: "manual",
        name: "Corner Cafe",
        address: "1 Main St",
        lat: 999,
        lng: 0,
      }).success
    ).toBe(false);
  });

  it("places mode keys on placeId only (the Place ID is the dedup key, not free text)", () => {
    // ADR-008: in places mode the client sends ONLY the chosen Place ID; the
    // canonical name/address/coords are resolved server-side and cannot be
    // hand-fabricated. The validator reflects that contract.
    const result = createListingInputSchema.safeParse({
      mode: "places",
      placeId: "ChIJ-place-123",
    });
    expect(result.success).toBe(true);
    expect(createListingInputSchema.safeParse({ mode: "places", placeId: "" }).success).toBe(false);
  });
});
