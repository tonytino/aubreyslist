import { describe, expect, it } from "vitest";
import { DuplicateListingError, parseDuplicateListingError } from "./dedup-error";

/**
 * Unit tests for the CLIENT-SAFE duplicate-listing error boundary (issue #141).
 * These mirror the contract previously covered in `app/server/listings/dedup.test.ts`
 * (which now re-imports these from the server module), proving the marker class +
 * parser keep working from the db-free module the intake forms import.
 */

describe("DuplicateListingError", () => {
  it("carries the existing listing id and name, with an actionable message", () => {
    const err = new DuplicateListingError({ id: "existing-9", name: "Corner Cafe" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DuplicateListingError");
    expect(err.existingListingId).toBe("existing-9");
    expect(err.existingListingName).toBe("Corner Cafe");
    expect(err.message).toContain("Corner Cafe");
    expect(err.message).toContain("already listed");
  });
});

describe("parseDuplicateListingError", () => {
  it("recovers the existing id and a marker-free message from a thrown error", () => {
    // Models the client side: across the server-fn RPC boundary the error arrives
    // as a plain Error with just the (marker-bearing) message, not the subclass.
    const thrown = new DuplicateListingError({ id: "existing-9", name: "Corner Cafe" });
    const plain = new Error(thrown.message);

    const parsed = parseDuplicateListingError(plain);
    expect(parsed).not.toBeNull();
    expect(parsed?.existingListingId).toBe("existing-9");
    // The machine-readable marker is stripped from what the UI displays.
    expect(parsed?.message).toContain("Corner Cafe");
    expect(parsed?.message).not.toContain("existing-listing:");
    expect(parsed?.message).not.toContain("[[");
  });

  it("returns null for an unrelated error (no marker)", () => {
    expect(parseDuplicateListingError(new Error("Something else went wrong"))).toBeNull();
  });

  it("returns null for non-error / non-string inputs", () => {
    expect(parseDuplicateListingError(undefined)).toBeNull();
    expect(parseDuplicateListingError(null)).toBeNull();
    expect(parseDuplicateListingError({ message: "[[existing-listing:x]]" })).toBeNull();
  });
});
