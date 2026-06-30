import { describe, expect, it } from "vitest";
import type { ClaimAggregate } from "~/server/attestations";
import { deriveListingTrustGlance } from "~/trust/browse-glance";
import { findRecentIncident, isRecentIncident } from "~/trust/incident-recency";
import {
  type ClaimTrustSummary,
  DEFAULT_STALENESS_MONTHS,
  deriveHeadlineSafetyState,
  isStale,
  summarizeClaim,
} from "~/trust/summary";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * CANONICAL TRUST-MODEL INVARIANT SUITE — ADR-007 / ADR-008 (issues #178, #185)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * DO NOT WEAKEN. These tests encode the product's core SAFETY guarantees — the
 * "evals" for the trust model. They are deliberately phrased as INVARIANTS over
 * the pure derivations (`app/trust/*`), so an agent's change to a trust function
 * cannot silently regress a guarantee a celiac relies on. If a change makes one
 * of these go red, the change is wrong (or the ADR must change first) — do not
 * adjust the test to make app code pass.
 *
 * Each `describe` block names the ADR-007/008 rule it pins (domain.md → Trust
 * Model / Listing Intake). Property-style blocks generate many inputs with plain
 * loops / `Array.from` (no new test libraries) and assert the invariant holds
 * across the whole generated space, not just hand-picked examples.
 *
 * The DB-enforced half of "one attestation per user per claim" (the UNIQUE
 * constraint) is a DB-gated integration test —
 * `tests/integration/schema-constraints.test.ts` already pins it, and
 * `tests/integration/trust-model.invariant.test.ts` re-pins it as part of THIS
 * canonical suite. Those self-skip without `TEST_DATABASE_URL`.
 */

// A fixed "now" keeps the suite deterministic; all ages are measured back from it.
const NOW = new Date("2026-06-30T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

/** Build a confirm/dispute/recency aggregate for a claim. */
function aggregate(
  confirmCount: number,
  disputeCount: number,
  lastConfirmedAt: Date | null
): Pick<ClaimAggregate, "confirmCount" | "disputeCount" | "lastConfirmedAt"> {
  return { confirmCount, disputeCount, lastConfirmedAt };
}

/** A small but varied spread of confirm/dispute counts for property-style loops. */
const COUNT_GRID = [0, 1, 2, 5, 8, 25, 100];

/** A spread of recency ages (ms back from NOW), straddling the staleness window. */
const AGE_GRID_MS = [
  0, // just now
  DAY_MS, // yesterday
  30 * DAY_MS, // ~1 month — fresh
  5 * MONTH_MS, // < 6 months — fresh
  6 * MONTH_MS - DAY_MS, // just inside the window — fresh
  6 * MONTH_MS + DAY_MS, // just past the window — stale
  12 * MONTH_MS, // a year — stale
];

// ───────────────────────────────────────────────────────────────────────────
// INVARIANT 1 — No secret scoring (ADR-007: "no secret scoring"; the summary is
// a roll-up of *visible* evidence, reproducible by any user looking at the same
// confirm/dispute counts + recency).
// ───────────────────────────────────────────────────────────────────────────

describe("INVARIANT 1 — no secret scoring (summary is a pure function of visible evidence)", () => {
  it("is DETERMINISTIC: identical visible inputs always yield an identical summary", () => {
    // Property-style: sweep the full grid of (confirm, dispute, recency) and
    // assert a second derivation from the SAME inputs is byte-identical. Any
    // hidden state (a clock read, randomness, a per-call counter) would break
    // reproducibility here.
    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID) {
        for (const ageMs of [...AGE_GRID_MS, null]) {
          const lastConfirmedAt = ageMs === null ? null : new Date(NOW.getTime() - ageMs);
          const agg = aggregate(confirmCount, disputeCount, lastConfirmedAt);

          const a = summarizeClaim("dedicated_fryer", agg, NOW);
          const b = summarizeClaim("dedicated_fryer", agg, NOW);
          expect(b).toEqual(a);

          // The headline state and the glance are likewise pure derivations.
          expect(deriveHeadlineSafetyState(agg, NOW)).toEqual(deriveHeadlineSafetyState(agg, NOW));
        }
      }
    }
  });

  it("derives EVERY summary field from the visible aggregate — no opaque field", () => {
    // The summary must carry nothing a user can't reconstruct from the visible
    // confirm/dispute counts + recency. We pin the exact field set so an added
    // field (e.g. a hidden weighted score) forces this invariant to be revisited.
    const summary: ClaimTrustSummary = summarizeClaim(
      "dedicated_fryer",
      aggregate(8, 1, new Date(NOW.getTime() - 21 * DAY_MS)),
      NOW
    );

    expect(Object.keys(summary).sort()).toEqual(
      [
        "attribute",
        "confirmCount",
        "countsLabel",
        "disputeCount",
        "hasEvidence",
        "label",
        "recencyLabel",
        "stale",
      ].sort()
    );

    // Each field is explainable directly from the visible counts/recency:
    expect(summary.confirmCount).toBe(8); // a visible count
    expect(summary.disputeCount).toBe(1); // a visible count
    expect(summary.countsLabel).toBe("8 confirm / 1 dispute"); // the visible distribution
    expect(summary.hasEvidence).toBe(true); // confirm+dispute > 0
    expect(summary.recencyLabel).toContain("last confirmed"); // the visible recency cue
  });

  it("ignores claim IDENTITY (claimId) — equal evidence ⇒ equal summary across different claims", () => {
    // The roll-up must depend only on the EVIDENCE, never on which claim row it
    // is (no per-claim hidden weighting). Same counts + recency on two different
    // claimIds ⇒ identical derived signal.
    const agg1: ClaimAggregate = {
      claimId: "claim-aaaa",
      ...aggregate(5, 2, new Date(NOW.getTime() - 10 * DAY_MS)),
    };
    const agg2: ClaimAggregate = {
      claimId: "claim-zzzz",
      ...aggregate(5, 2, new Date(NOW.getTime() - 10 * DAY_MS)),
    };

    expect(summarizeClaim("dedicated_fryer", agg2, NOW)).toEqual(
      summarizeClaim("dedicated_fryer", agg1, NOW)
    );
    expect(deriveHeadlineSafetyState(agg2, NOW)).toBe(deriveHeadlineSafetyState(agg1, NOW));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// INVARIANT 2 — Recent incident dominates (ADR-007: "Recent incidents visibly
// flag the trust summary regardless of older confirmations — fresh harm is
// never buried"). The browse glance keeps the incident flag as its OWN field,
// independent of the confirm-majority safety state.
// ───────────────────────────────────────────────────────────────────────────

describe("INVARIANT 2 — a recent incident flags the summary regardless of confirmations", () => {
  it("surfaces hasRecentIncident as an orthogonal field that tracks its input for ANY confirm count", () => {
    // Property-style: a glowingly-confirmed, perfectly-fresh celiac-safe claim
    // (the strongest possible positive evidence) must STILL carry the recent-
    // incident flag when one exists — old/large confirmations can never bury
    // fresh harm. We sweep BOTH flag values so this proves the field TRACKS its
    // input (not a hard-coded constant), not just that `true` round-trips.
    const freshConfirm = new Date(NOW.getTime() - DAY_MS); // confirmed yesterday → celiac-safe
    for (const confirmCount of COUNT_GRID) {
      const celiacSafe = aggregate(confirmCount, 0, freshConfirm);
      for (const hasRecentIncident of [true, false]) {
        const glance = deriveListingTrustGlance(celiacSafe, hasRecentIncident, NOW);

        // Surfaced verbatim, never buried by the confirm count.
        expect(glance.hasRecentIncident).toBe(hasRecentIncident);
        // The incident flag is orthogonal: it does NOT silently flip the headline
        // state, it sits ALONGSIDE it so the card shows both (never just "safe").
        if (confirmCount > 0) {
          expect(glance.safetyState).toBe("celiac-safe");
        }
      }
    }
  });

  it("never reads as silently safe: a within-window incident is `isRecentIncident` true", () => {
    // Ground the exact semantics in incident-recency.ts: an incident dated
    // anywhere in [now - 90d, now] is recent (inclusive boundary). Across a
    // dense grid of in-window ages, the flag is always true.
    for (let daysAgo = 0; daysAgo <= 90; daysAgo += 1) {
      const occurred = new Date(NOW.getTime() - daysAgo * DAY_MS);
      const occurredOn = occurred.toISOString().slice(0, 10);
      expect(isRecentIncident(occurredOn, NOW)).toBe(true);
    }
  });

  it("a recent incident is selected REGARDLESS of how many older incidents exist", () => {
    // findRecentIncident must surface a recent report even when buried among many
    // stale ones — the banner fires off the freshest in-window incident.
    const stale = Array.from({ length: 50 }, (_, i) => ({
      occurredOn: new Date(NOW.getTime() - (200 + i) * DAY_MS).toISOString().slice(0, 10),
    }));
    const recent = { occurredOn: new Date(NOW.getTime() - 3 * DAY_MS).toISOString().slice(0, 10) };

    // Order-independent: shuffle the recent one into the middle of the stale pile.
    const incidents = [...stale.slice(0, 25), recent, ...stale.slice(25)];
    expect(findRecentIncident(incidents, NOW)).toEqual(recent);
  });

  it("an out-of-window incident does NOT flag — the window is honest both ways", () => {
    // The dominance rule must not over-fire: an incident strictly older than the
    // 90-day window is not recent, so it does not pin the banner forever.
    const old = new Date(NOW.getTime() - 91 * DAY_MS).toISOString().slice(0, 10);
    expect(isRecentIncident(old, NOW)).toBe(false);
    expect(findRecentIncident([{ occurredOn: old }], NOW)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// INVARIANT 4 — Staleness flags, never hides (ADR-007: a claim not confirmed
// within the 6-month admin-tunable window gets a "may be stale" treatment — it
// is SURFACED, not removed). Invariant 3 (one-per-user) is server/DB-side; see
// the integration suite.
// ───────────────────────────────────────────────────────────────────────────

describe("INVARIANT 4 — staleness FLAGS a claim, never hides/removes it", () => {
  it("a stale claim still renders its full summary (counts + recency stay visible)", () => {
    // Property-style: for every count combo with a confirmation past the window,
    // the summary still carries the SAME visible distribution — staleness only
    // adds a `stale: true` flag, it never zeroes counts or drops the claim.
    const pastWindow = new Date(NOW.getTime() - (6 * MONTH_MS + DAY_MS));
    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID) {
        const summary = summarizeClaim(
          "dedicated_fryer",
          aggregate(confirmCount, disputeCount, pastWindow),
          NOW
        );
        expect(summary.stale).toBe(true);
        // Evidence is NOT hidden by staleness:
        expect(summary.confirmCount).toBe(confirmCount);
        expect(summary.disputeCount).toBe(disputeCount);
        expect(summary.countsLabel).toBe(`${confirmCount} confirm / ${disputeCount} dispute`);
        expect(summary.hasEvidence).toBe(confirmCount + disputeCount > 0);
      }
    }
  });

  it("a confirm-majority stale claim surfaces the `stale` headline state (flagged, not dropped)", () => {
    // A fresh-enough confirm-majority is "celiac-safe"; once it ages past the
    // window the SAME evidence is surfaced as "stale" — never null/hidden.
    const fresh = aggregate(5, 1, new Date(NOW.getTime() - DAY_MS));
    const stale = aggregate(5, 1, new Date(NOW.getTime() - (6 * MONTH_MS + DAY_MS)));
    expect(deriveHeadlineSafetyState(fresh, NOW)).toBe("celiac-safe");
    expect(deriveHeadlineSafetyState(stale, NOW)).toBe("stale");
  });

  it("honours the admin-tunable window (default 6 months) — boundary is inclusive-fresh", () => {
    // ADR-007: the window is an admin-tunable AppSetting; the default is 6
    // months. A confirmation EXACTLY on the edge is fresh; strictly older is
    // stale. Pin both the default and a custom (tightened) window.
    const exactlyDefault = new Date(NOW.getTime() - DEFAULT_STALENESS_MONTHS * MONTH_MS);
    expect(isStale(exactlyDefault, NOW)).toBe(false); // on the edge ⇒ fresh
    expect(isStale(new Date(exactlyDefault.getTime() - DAY_MS), NOW)).toBe(true); // older ⇒ stale

    // Custom admin window of 1 month: a 2-month-old confirm is now stale.
    const twoMonths = new Date(NOW.getTime() - 2 * MONTH_MS);
    expect(isStale(twoMonths, NOW, 1)).toBe(true);
    expect(isStale(twoMonths, NOW, 6)).toBe(false);
  });

  it("a never-confirmed claim is NOT 'stale' — it has no recency to age out", () => {
    // Honest empty state: a claim never confirmed shows "not yet confirmed", not
    // a fabricated staleness flag (ADR-007).
    const summary = summarizeClaim("dedicated_fryer", aggregate(0, 0, null), NOW);
    expect(summary.stale).toBe(false);
    expect(summary.recencyLabel).toBe("not yet confirmed");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// INVARIANT 5 (dedup half) — ADR-008 intake: Place ID is the dedup key, and the
// manual-entry fallback path is reachable (not dead code). The DB-level
// UNIQUE(place_id) is pinned in the integration suite; here we pin the pure
// manual-dedup safeguard + the always-present manual-entry validation path.
//
// Lives alongside in `app/server/listings/intake-dedup.invariant.test.ts` so it
// can value-import the server-only dedup module. (browse-glance/summary/incident
// invariants stay client-safe in THIS file.)
// ───────────────────────────────────────────────────────────────────────────
