import { describe, expect, it } from "vitest";
import { createListingInputSchema } from "./create-input";

/**
 * Unit tests for the CLIENT-SAFE add-listing input schema (issue #141; the
 * typed-links scheme allowlist is #90 / AUB-202). These prove the validator the
 * `submitCreateListing` server fn binds works from the db-free module,
 * including the http(s)-only guard that blocks the stored-XSS vector.
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

describe("createListingInputSchema — typed links (#90, AUB-202)", () => {
  it("accepts an omitted links array (all fields left blank)", () => {
    const result = createListingInputSchema.safeParse(manualBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.links).toBeUndefined();
    }
  });

  it("accepts a set of typed https links in both modes", () => {
    const links = [
      { kind: "menu", url: "https://example.com/menu" },
      { kind: "website", url: "https://example.com" },
    ];
    expect(createListingInputSchema.safeParse({ ...manualBase, links }).success).toBe(true);
    expect(createListingInputSchema.safeParse({ ...placesBase, links }).success).toBe(true);
  });

  it("rejects a javascript: scheme URL", () => {
    expect(
      createListingInputSchema.safeParse({
        ...manualBase,
        links: [{ kind: "menu", url: "javascript:alert(1)" }],
      }).success
    ).toBe(false);
  });

  it("rejects a data: scheme URL", () => {
    expect(
      createListingInputSchema.safeParse({
        ...manualBase,
        links: [{ kind: "menu", url: "data:text/html,<script>" }],
      }).success
    ).toBe(false);
  });

  it("rejects a duplicate kind (one link per kind)", () => {
    expect(
      createListingInputSchema.safeParse({
        ...manualBase,
        links: [
          { kind: "menu", url: "https://example.com/a" },
          { kind: "menu", url: "https://example.com/b" },
        ],
      }).success
    ).toBe(false);
  });

  it("rejects a blank URL entry (blanks are dropped client-side, never submitted)", () => {
    expect(
      createListingInputSchema.safeParse({ ...manualBase, links: [{ kind: "menu", url: "" }] })
        .success
    ).toBe(false);
  });
});
