import { describe, expect, it } from "vitest";
import { deriveListingTrustGlance } from "./browse-glance";

/**
 * Tests for the pure browse-list at-a-glance derivation. Verifies it wires
 * the headline derivation, the distinct-contributor count, the
 * recent-incident instant, and the freshness cue honestly — especially the
 * "no evidence → Not yet attested / no counts" and recent-incident cases.
 */

const NOW = new Date("2026-06-28T00:00:00Z");

describe("deriveListingTrustGlance", () => {
  it("returns null safetyState (Not yet attested) and null evidence with no celiac claim", () => {
    const glance = deriveListingTrustGlance(null, 0, null, NOW);
    expect(glance.safetyState).toBeNull();
    expect(glance.hasRecentIncident).toBe(false);
    expect(glance.evidence).toBeNull();
    expect(glance.freshness).toBeNull();
    expect(glance.suggestedAttributes).toEqual([]);
  });

  it("treats an UNDEFINED aggregate exactly like a null one (missing map entry)", () => {
    // The signature and JSDoc declare `null | undefined` as the public contract.
    // (browse.ts currently coalesces with `?? null` before calling, so undefined
    // cannot reach it from there today — this pins the declared contract, not a
    // reachable browse path.) It must produce the same honest empty state rather
    // than throwing.
    const glance = deriveListingTrustGlance(undefined, 0, null, NOW);
    expect(glance.safetyState).toBeNull();
    expect(glance.evidence).toBeNull();
    expect(glance.hasRecentIncident).toBe(false);
    expect(glance.suggestedByBot).toBe(false);
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

  it("flags suggestedByBot for a bot-suggested celiac claim with no votes (AUB-31)", () => {
    const glance = deriveListingTrustGlance(
      { confirmCount: 0, disputeCount: 0, lastConfirmedAt: null, suggested: true },
      0,
      null,
      NOW
    );
    // Provenance only — no fabricated verdict.
    expect(glance.suggestedByBot).toBe(true);
    // The celiac fallback flag folds into the attribute set, so the card can
    // badge the suggested claim even without the batched per-attribute set.
    expect(glance.suggestedAttributes).toEqual(["celiac_safe_vs_gluten_friendly"]);
    expect(glance.safetyState).toBeNull();
    expect(glance.evidence).toBeNull();
  });

  it("drops the celiac claim's own suggestion once THAT claim has real evidence (vote clears it)", () => {
    // Per-claim honesty: a vote clears `suggested_by` server-side, so a voted
    // celiac claim's suggestion is not live and never badges the card.
    const glance = deriveListingTrustGlance(
      {
        confirmCount: 2,
        disputeCount: 0,
        lastConfirmedAt: new Date("2026-06-25T00:00:00Z"),
        suggested: true,
      },
      2,
      null,
      NOW
    );
    expect(glance.suggestedByBot).toBe(false);
    expect(glance.suggestedAttributes).toEqual([]);
    expect(glance.safetyState).toBe("celiac-safe");
  });

  it("defaults suggestedByBot to false when the aggregate omits the flag", () => {
    const glance = deriveListingTrustGlance(
      { confirmCount: 0, disputeCount: 0, lastConfirmedAt: null },
      0,
      null,
      NOW
    );
    expect(glance.suggestedByBot).toBe(false);
    expect(glance.suggestedAttributes).toEqual([]);
  });

  it("flags suggestedByBot from a NON-celiac bot suggestion with no celiac claim (AUB-193)", () => {
    // A seeded listing whose bot labels are all non-celiac attributes: there is
    // no celiac aggregate at all, but the batched suggested-attribute set is live.
    const glance = deriveListingTrustGlance(null, 0, null, NOW, undefined, ["dedicated_fryer"]);
    expect(glance.suggestedByBot).toBe(true);
    expect(glance.suggestedAttributes).toEqual(["dedicated_fryer"]);
    // Still the honest empty state — provenance, never a verdict.
    expect(glance.safetyState).toBeNull();
    expect(glance.evidence).toBeNull();
  });

  it("flags suggestedByBot from a non-celiac suggestion when the celiac claim exists but has no votes", () => {
    const glance = deriveListingTrustGlance(
      { confirmCount: 0, disputeCount: 0, lastConfirmedAt: null },
      0,
      null,
      NOW,
      undefined,
      ["gf_substitutes"]
    );
    expect(glance.suggestedByBot).toBe(true);
    expect(glance.suggestedAttributes).toEqual(["gf_substitutes"]);
    expect(glance.safetyState).toBeNull();
  });

  it("KEEPS the bot label when live suggestions coexist with real celiac evidence (owner nit 7)", () => {
    // The label is provenance, not gated on "no evidence" any more: a listing
    // with community celiac evidence can still carry live suggestions on other
    // attributes, and where those labels came from stays true. The verdict and
    // counts still derive from evidence only — never from the suggestion.
    const glance = deriveListingTrustGlance(
      { confirmCount: 3, disputeCount: 0, lastConfirmedAt: new Date("2026-06-25T00:00:00Z") },
      3,
      null,
      NOW,
      undefined,
      ["dedicated_fryer"]
    );
    expect(glance.suggestedByBot).toBe(true);
    expect(glance.suggestedAttributes).toEqual(["dedicated_fryer"]);
    expect(glance.safetyState).toBe("celiac-safe");
    expect(glance.evidence).toEqual({ confirmations: 3, contributors: 3 });
  });

  it("does NOT flag suggestedByBot when nothing is suggested (cleared by a real vote)", () => {
    // Models the "suggestion cleared by a real vote" case: `suggested_by` was
    // nulled server-side, so the batched per-attribute set comes back empty.
    const glance = deriveListingTrustGlance(null, 0, null, NOW, undefined, []);
    expect(glance.suggestedByBot).toBe(false);
    expect(glance.suggestedAttributes).toEqual([]);
  });

  it("dedupes and normalizes suggestedAttributes to taxonomy order", () => {
    const glance = deriveListingTrustGlance(
      { confirmCount: 0, disputeCount: 0, lastConfirmedAt: null, suggested: true },
      0,
      null,
      NOW,
      undefined,
      // Out of order + a duplicate + celiac already present (so the fallback
      // fold-in must not double it).
      ["gf_substitutes", "dedicated_fryer", "gf_substitutes", "celiac_safe_vs_gluten_friendly"]
    );
    expect(glance.suggestedAttributes).toEqual([
      "celiac_safe_vs_gluten_friendly",
      "dedicated_fryer",
      "gf_substitutes",
    ]);
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

  it("collapses a contested claim to the UNATTESTED glance — no badge, no cue, no counts", () => {
    // A contested headline claim renders exactly the glance an unattested
    // listing gets. The suppression covers all three confirmation-derived
    // signals: leaving the freshness cue or the evidence meta in place would
    // show a cue an unattested card cannot, turning "no verdict" into a
    // legible downgrade the community never voted for. The counts stay
    // readable on the detail page's claim row instead.
    const unattested = deriveListingTrustGlance(
      { confirmCount: 0, disputeCount: 0, lastConfirmedAt: null },
      0,
      null,
      NOW
    );

    const glance = deriveListingTrustGlance(
      { confirmCount: 2, disputeCount: 5, lastConfirmedAt: new Date("2026-06-01T00:00:00Z") },
      6,
      null,
      NOW
    );
    expect(glance.safetyState).toBeNull();
    expect(glance.evidence).toBeNull();
    expect(glance.freshness).toBeNull();
    expect(glance).toEqual(unattested);

    // A tie is contested too — same empty glance.
    const tied = deriveListingTrustGlance(
      { confirmCount: 3, disputeCount: 3, lastConfirmedAt: new Date("2026-06-01T00:00:00Z") },
      6,
      null,
      NOW
    );
    expect(tied).toEqual(unattested);
  });

  it("keeps the INCIDENT cue on a contested listing (harm outranks the suppression)", () => {
    // The suppression withholds a verdict the app will not make; it must never
    // withhold a warning the community did make.
    const glance = deriveListingTrustGlance(
      { confirmCount: 2, disputeCount: 5, lastConfirmedAt: new Date("2026-06-01T00:00:00Z") },
      6,
      new Date("2026-06-26T00:00:00Z"),
      NOW
    );
    expect(glance.safetyState).toBeNull();
    expect(glance.evidence).toBeNull();
    expect(glance.hasRecentIncident).toBe(true);
    expect(glance.freshness?.kind).toBe("incident");
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
