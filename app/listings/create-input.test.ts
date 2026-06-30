import { describe, expect, it } from "vitest";
import { createListingInputSchema } from "./create-input";

/**
 * Unit tests for the CLIENT-SAFE add-listing input schema (issue #141; the
 * menuUrl scheme allowlist is #90). These prove the validator the `submitCreateListing`
 * server fn binds works from the db-free module, including the http(s)-only
 * guard that blocks the stored-XSS vector.
 */

const placesBase = { mode: "places" as const, placeId: "place-123" };
const manualBase = {
  mode: "manual" as const,
  name: "Corner Cafe",
  address: "1 Main St, Denver, CO",
  lat: 39.7,
  lng: -104.9,
};

describe("createListingInputSchema — discriminated union", () => {
  it("accepts a valid places submission", () => {
    expect(createListingInputSchema.safeParse(placesBase).success).toBe(true);
  });

  it("accepts a valid manual submission", () => {
    expect(createListingInputSchema.safeParse(manualBase).success).toBe(true);
  });

  it("rejects a places submission with an empty placeId", () => {
    expect(createListingInputSchema.safeParse({ mode: "places", placeId: "" }).success).toBe(false);
  });

  it("rejects out-of-range manual coordinates", () => {
    expect(createListingInputSchema.safeParse({ ...manualBase, lat: 200 }).success).toBe(false);
  });

  it("rejects a whitespace-only manual name (#158)", () => {
    expect(createListingInputSchema.safeParse({ ...manualBase, name: "   " }).success).toBe(false);
  });

  it("rejects a whitespace-only manual address (#158)", () => {
    expect(createListingInputSchema.safeParse({ ...manualBase, address: "   " }).success).toBe(
      false
    );
  });

  it("trims surrounding whitespace from a valid manual name/address (#158)", () => {
    const result = createListingInputSchema.safeParse({
      ...manualBase,
      name: " Joe's ",
      address: "  1 Main St, Denver, CO  ",
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.mode === "manual") {
      expect(result.data.name).toBe("Joe's");
      expect(result.data.address).toBe("1 Main St, Denver, CO");
    }
  });
});

describe("createListingInputSchema — menuUrl scheme allowlist (#90)", () => {
  it("accepts an https menu URL", () => {
    expect(
      createListingInputSchema.safeParse({ ...manualBase, menuUrl: "https://example.com/menu" })
        .success
    ).toBe(true);
  });

  it("rejects a javascript: scheme URL", () => {
    expect(
      createListingInputSchema.safeParse({ ...manualBase, menuUrl: "javascript:alert(1)" }).success
    ).toBe(false);
  });

  it("rejects a data: scheme URL", () => {
    expect(
      createListingInputSchema.safeParse({ ...manualBase, menuUrl: "data:text/html,<script>" })
        .success
    ).toBe(false);
  });

  it("normalises a blank menuUrl to undefined", () => {
    const result = createListingInputSchema.safeParse({ ...manualBase, menuUrl: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.menuUrl).toBeUndefined();
    }
  });
});
