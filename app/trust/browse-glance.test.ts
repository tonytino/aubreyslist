import { describe, expect, it } from "vitest";
import { deriveListingTrustGlance } from "./browse-glance";

/**
 * Tests for the pure browse-list at-a-glance derivation (#33). Verifies it wires
 * the #29 headline derivation + the precomputed recent-incident flag honestly —
 * especially the "no evidence → Not yet attested" and recent-incident cases.
 */

const NOW = new Date("2026-06-28T00:00:00Z");

describe("deriveListingTrustGlance", () => {
  it("returns null safetyState (Not yet attested) when there is no celiac claim", () => {
    const glance = deriveListingTrustGlance(null, false, NOW);
    expect(glance.safetyState).toBeNull();
    expect(glance.hasRecentIncident).toBe(false);
  });

  it("returns null safetyState when the celiac claim has no evidence", () => {
    const glance = deriveListingTrustGlance(
      { confirmCount: 0, disputeCount: 0, lastConfirmedAt: null },
      false,
      NOW
    );
    expect(glance.safetyState).toBeNull();
  });

  it("derives celiac-safe when confirms lead and the confirmation is fresh", () => {
    const glance = deriveListingTrustGlance(
      { confirmCount: 8, disputeCount: 1, lastConfirmedAt: new Date("2026-06-01T00:00:00Z") },
      false,
      NOW
    );
    expect(glance.safetyState).toBe("celiac-safe");
  });

  it("derives gluten-friendly when disputes tie or outnumber confirms", () => {
    const glance = deriveListingTrustGlance(
      { confirmCount: 2, disputeCount: 5, lastConfirmedAt: new Date("2026-06-01T00:00:00Z") },
      false,
      NOW
    );
    expect(glance.safetyState).toBe("gluten-friendly");
  });

  it("derives stale when confirms lead but the confirmation aged out of the window", () => {
    const glance = deriveListingTrustGlance(
      { confirmCount: 5, disputeCount: 0, lastConfirmedAt: new Date("2024-01-01T00:00:00Z") },
      false,
      NOW
    );
    expect(glance.safetyState).toBe("stale");
  });

  it("respects an admin-tuned staleness window", () => {
    // 4 months old: stale at a 3-month window, fresh at the default 6-month one.
    const aggregate = {
      confirmCount: 5,
      disputeCount: 0,
      lastConfirmedAt: new Date("2026-02-20T00:00:00Z"),
    };
    expect(deriveListingTrustGlance(aggregate, false, NOW, 3).safetyState).toBe("stale");
    expect(deriveListingTrustGlance(aggregate, false, NOW, 6).safetyState).toBe("celiac-safe");
  });

  it("passes the recent-incident flag through unchanged", () => {
    const safe = { confirmCount: 8, disputeCount: 0, lastConfirmedAt: new Date("2026-06-01") };
    expect(deriveListingTrustGlance(safe, true, NOW).hasRecentIncident).toBe(true);
    // A recent incident can coexist with a celiac-safe headline — both surface.
    expect(deriveListingTrustGlance(safe, true, NOW).safetyState).toBe("celiac-safe");
  });
});
