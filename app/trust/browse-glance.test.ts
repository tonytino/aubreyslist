import { describe, expect, it } from "vitest";
import { deriveListingTrustGlance } from "./browse-glance";

/**
 * Tests for the pure browse-list at-a-glance derivation (#33, extended for the
 * AUB-61 redesign's evidence counts + freshness cue). Verifies it wires the #29
 * headline derivation, the distinct-contributor count, the recent-incident
 * instant, and the freshness cue honestly — especially the "no evidence → Not
 * yet attested / no counts" and recent-incident cases.
 */

const NOW = new Date("2026-06-28T00:00:00Z");

describe("deriveListingTrustGlance", () => {
  it("returns null safetyState (Not yet attested) and null evidence with no celiac claim", () => {
    const glance = deriveListingTrustGlance(null, 0, null, NOW);
    expect(glance.safetyState).toBeNull();
    expect(glance.hasRecentIncident).toBe(false);
    expect(glance.evidence).toBeNull();
    expect(glance.freshness).toBeNull();
  });

  it("returns null safetyState AND null evidence when the celiac claim has no votes", () => {
    const glance = deriveListingTrustGlance(
      { confirmCount: 0, disputeCount: 0, lastConfirmedAt: null },
      0,
      null,
      NOW
    );
    expect(glance.safetyState).toBeNull();
    // A zero-vote claim shows the honest empty state, never "0 confirmations".
    expect(glance.evidence).toBeNull();
  });

  it("derives celiac-safe + fresh cue + evidence counts when confirms lead and fresh", () => {
    const glance = deriveListingTrustGlance(
      { confirmCount: 8, disputeCount: 1, lastConfirmedAt: new Date("2026-06-25T00:00:00Z") },
      5,
      null,
      NOW
    );
    expect(glance.safetyState).toBe("celiac-safe");
    expect(glance.evidence).toEqual({ confirmations: 8, contributors: 5 });
    expect(glance.freshness).toEqual({ kind: "fresh", label: "Verified 3d ago" });
  });

  it("derives gluten-friendly when disputes tie or outnumber confirms", () => {
    const glance = deriveListingTrustGlance(
      { confirmCount: 2, disputeCount: 5, lastConfirmedAt: new Date("2026-06-01T00:00:00Z") },
      6,
      null,
      NOW
    );
    expect(glance.safetyState).toBe("gluten-friendly");
    expect(glance.evidence).toEqual({ confirmations: 2, contributors: 6 });
  });

  it("derives stale + stale cue when confirms lead but the confirmation aged out", () => {
    const glance = deriveListingTrustGlance(
      { confirmCount: 5, disputeCount: 0, lastConfirmedAt: new Date("2024-01-01T00:00:00Z") },
      5,
      null,
      NOW
    );
    expect(glance.safetyState).toBe("stale");
    expect(glance.freshness?.kind).toBe("stale");
    expect(glance.freshness?.label.startsWith("Updated ")).toBe(true);
  });

  it("respects an admin-tuned staleness window", () => {
    // 4 months old: stale at a 3-month window, fresh at the default 6-month one.
    const aggregate = {
      confirmCount: 5,
      disputeCount: 0,
      lastConfirmedAt: new Date("2026-02-20T00:00:00Z"),
    };
    expect(deriveListingTrustGlance(aggregate, 5, null, NOW, 3).safetyState).toBe("stale");
    expect(deriveListingTrustGlance(aggregate, 5, null, NOW, 6).safetyState).toBe("celiac-safe");
  });

  it("flags a recent incident from its instant and surfaces the incident cue", () => {
    const safe = { confirmCount: 8, disputeCount: 0, lastConfirmedAt: new Date("2026-06-25") };
    const incidentAt = new Date("2026-06-25T00:00:00Z"); // 3 days before NOW
    const glance = deriveListingTrustGlance(safe, 8, incidentAt, NOW);
    expect(glance.hasRecentIncident).toBe(true);
    // A recent incident can coexist with a celiac-safe headline — both surface;
    // the freshness cue is the loudest (incident) one.
    expect(glance.safetyState).toBe("celiac-safe");
    expect(glance.freshness).toEqual({ kind: "incident", label: "Reported 3d ago" });
  });

  it("has no recent incident (and no incident cue) when the instant is null", () => {
    const safe = { confirmCount: 8, disputeCount: 0, lastConfirmedAt: new Date("2026-06-25") };
    const glance = deriveListingTrustGlance(safe, 8, null, NOW);
    expect(glance.hasRecentIncident).toBe(false);
    expect(glance.freshness?.kind).toBe("fresh");
  });
});
