import { describe, expect, it } from "vitest";
import type { ClaimAggregate } from "~/server/attestations";
import { deriveListingTrustGlance } from "~/trust/browse-glance";
import { findRecentIncident, isRecentIncident } from "~/trust/incident-recency";
import {
  type ClaimTrustSummary,
  DEFAULT_STALENESS_MONTHS,
  deriveHeadlineSafetyState,
  hasPositiveConsensus,
  isStale,
  safetyTierRank,
  summarizeClaim,
} from "~/trust/summary";

/**
 * Canonical trust-model invariant suite — ADR-007 / ADR-008.
 *
 * Do not weaken. These tests encode the product's core safety guarantees —
 * the "evals" for the trust model — phrased as invariants over the pure
 * derivations (`app/trust/*`), so a change to a trust function cannot
 * silently regress a guarantee a celiac relies on. If a change makes one of
 * these go red, the change is wrong (or the ADR must change first) — do not
 * adjust the test to make app code pass.
 *
 * Each `describe` block names the ADR-007/008 rule it pins (domain.md → Trust
 * Model / Listing Intake). Property-style blocks generate many inputs with
 * plain loops (no new test libraries) and assert the invariant across the
 * whole generated space, not just hand-picked examples.
 *
 * ---------------------------------------------------------------------------
 * Owner decision, 2026-08-25 — the "gluten-friendly" state is gone.
 *
 * The headline safety vocabulary is `celiac-safe | stale | incident`, and
 * `deriveHeadlineSafetyState` returns `null` for BOTH an unattested claim and
 * a contested one (disputes tie or outnumber confirms). **A disputed claim and
 * an unattested claim render identically, by design.** The app makes no
 * negative safety assertion on the community's behalf: it either shows a
 * badge it can stand behind, or it shows none.
 *
 * Scope of that suppression, exactly:
 *   - SUPPRESSED at glance level — the safety badge, the freshness cue, and
 *     the evidence meta ("N confirmations · M neighbors"). All three are
 *     withheld together, because any one of them surviving would leak the
 *     verdict the badge withholds and would distinguish a contested card from
 *     a never-reviewed one.
 *   - KEPT — the confirm/dispute counts on the detail-page claim row
 *     (`summarizeClaim`), and every incident signal. The claim row is where a
 *     contest is legible; recent harm outranks the whole rule.
 *
 * Invariants 6 and 7 below pin that decision; the safety half of it (a contest
 * can only ever REMOVE a signal, never add or soften one) is what must not
 * regress.
 * ---------------------------------------------------------------------------
 *
 * The DB-enforced half of "one attestation per user per claim" (the UNIQUE
 * constraint) is pinned by `tests/integration/schema-constraints.test.ts` and
 * `tests/integration/trust-model.invariant.test.ts`; those self-skip without
 * `TEST_DATABASE_URL`.
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
// Invariant 1 — no secret scoring (ADR-007: the summary is a roll-up of
// visible evidence, reproducible by any user looking at the same
// confirm/dispute counts + recency).
// ───────────────────────────────────────────────────────────────────────────

describe("INVARIANT 1 — no secret scoring (summary is a pure function of visible evidence)", () => {
  it("is DETERMINISTIC: identical visible inputs always yield an identical summary", () => {
    // Property-style: sweep the full grid of (confirm, dispute, recency) and
    // assert a second derivation from the same inputs is byte-identical. Any
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
    // The summary must carry nothing a user can't reconstruct from visible
    // evidence: the confirm/dispute counts + recency, plus `suggested` — the
    // curator-bot provenance surfaced as the "Suggested by Aubrey's Bot"
    // badge, visible and explainable, never a hidden weighted score. The
    // exact field set is pinned so an added field (e.g. a secret score)
    // forces this invariant to be revisited.
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
        "suggested",
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
    // The roll-up must depend only on the evidence, never on which claim row it
    // is (no per-claim hidden weighting). Same counts + recency on two different
    // claimIds ⇒ identical derived signal.
    const agg1: ClaimAggregate = {
      claimId: "claim-aaaa",
      suggested: false,
      ...aggregate(5, 2, new Date(NOW.getTime() - 10 * DAY_MS)),
    };
    const agg2: ClaimAggregate = {
      claimId: "claim-zzzz",
      suggested: false,
      ...aggregate(5, 2, new Date(NOW.getTime() - 10 * DAY_MS)),
    };

    expect(summarizeClaim("dedicated_fryer", agg2, NOW)).toEqual(
      summarizeClaim("dedicated_fryer", agg1, NOW)
    );
    expect(deriveHeadlineSafetyState(agg2, NOW)).toBe(deriveHeadlineSafetyState(agg1, NOW));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Invariant 2 — recent incident dominates (ADR-007: "Recent incidents visibly
// flag the trust summary regardless of older confirmations — fresh harm is
// never buried"). The browse glance keeps the incident flag as its own field,
// independent of the confirm-majority safety state.
// ───────────────────────────────────────────────────────────────────────────

describe("INVARIANT 2 — a recent incident flags the summary regardless of confirmations", () => {
  it("surfaces hasRecentIncident as an orthogonal field that tracks its input for ANY confirm count", () => {
    // Property-style: a glowingly-confirmed, perfectly-fresh celiac-safe claim
    // (the strongest possible positive evidence) must still carry the recent-
    // incident flag when one exists — old/large confirmations can never bury
    // fresh harm. We sweep both flag values so this proves the field tracks its
    // input (not a hard-coded constant), not just that `true` round-trips.
    const freshConfirm = new Date(NOW.getTime() - DAY_MS); // confirmed yesterday → celiac-safe
    for (const confirmCount of COUNT_GRID) {
      const celiacSafe = aggregate(confirmCount, 0, freshConfirm);
      for (const hasRecentIncident of [true, false]) {
        // The glance now takes the most recent in-window incident's instant (or
        // null); `hasRecentIncident` is derived from it (non-null ⟺ flagged), so
        // we thread a within-window date when the case wants the flag set.
        const recentIncidentAt = hasRecentIncident ? new Date(NOW.getTime() - DAY_MS) : null;
        const glance = deriveListingTrustGlance(celiacSafe, 1, recentIncidentAt, NOW);

        // Surfaced verbatim, never buried by the confirm count.
        expect(glance.hasRecentIncident).toBe(hasRecentIncident);
        // The incident flag is orthogonal: it does not silently flip the headline
        // state, it sits alongside it so the card shows both (never just "safe").
        if (confirmCount > 0) {
          expect(glance.safetyState).toBe("celiac-safe");
        }
      }
    }
  });

  it("still flags a recent incident when the headline state is SUPPRESSED (contested)", () => {
    // A contested claim renders exactly like an unattested one —
    // `safetyState: null`. The incident must not vanish with the badge: a
    // listing with no badge AND a recent "got glutened" report is precisely
    // the one a celiac most needs warned about. Swept across the count grid
    // in the contested direction (disputes >= confirms) plus the empty case.
    const incidentAt = new Date(NOW.getTime() - 2 * DAY_MS);
    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID.filter((d) => d >= confirmCount)) {
        const contested = aggregate(confirmCount, disputeCount, new Date(NOW.getTime() - DAY_MS));
        const glance = deriveListingTrustGlance(contested, 1, incidentAt, NOW);

        // Precondition for this case: the headline really is suppressed.
        expect(glance.safetyState).toBeNull();
        // …and the incident survives the suppression, in both the flag and the
        // freshness cue (incident outranks every recency phrasing, ADR-007).
        expect(glance.hasRecentIncident).toBe(true);
        expect(glance.freshness?.kind).toBe("incident");
      }
    }
  });

  it("flags a recent incident on an UNATTESTED listing too (no evidence to bury it behind)", () => {
    const glance = deriveListingTrustGlance(null, 0, new Date(NOW.getTime() - DAY_MS), NOW);
    expect(glance.safetyState).toBeNull();
    expect(glance.hasRecentIncident).toBe(true);
    expect(glance.freshness?.kind).toBe("incident");
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
// Invariant 2b — a bot suggestion is provenance, never a verdict (ADR-007).
// The label/badges are provenance and show whenever live suggestions exist —
// including alongside real community evidence on other claims — but a
// suggestion must never influence the safety verdict or the evidence counts:
// `safetyState`/`evidence` are a pure function of the visible evidence alone,
// identical with or without suggestions. The headline celiac claim's own
// `suggested` fallback flag stays live only while that claim has no votes (a
// vote clears the suggestion server-side).
// ───────────────────────────────────────────────────────────────────────────

describe("INVARIANT 2b — a bot suggestion never influences the verdict or evidence", () => {
  it("safetyState and evidence are IDENTICAL with and without live suggestions, across the grid", () => {
    // Property-style: sweep counts × both fallback-flag values × both suggested
    // attribute sets. The verdict/evidence half of the glance must be byte-equal
    // to the suggestion-free derivation — a suggestion can never upgrade,
    // downgrade, or fabricate a verdict or a count.
    const freshConfirm = new Date(NOW.getTime() - DAY_MS);
    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID) {
        for (const celiacSuggested of [true, false]) {
          for (const suggestedAttributes of [[], ["dedicated_fryer" as const]]) {
            const evidenceOnly = aggregate(
              confirmCount,
              disputeCount,
              confirmCount > 0 ? freshConfirm : null
            );
            const agg = { ...evidenceOnly, suggested: celiacSuggested };
            const glance = deriveListingTrustGlance(
              agg,
              1,
              null,
              NOW,
              undefined,
              suggestedAttributes
            );
            const baseline = deriveListingTrustGlance(evidenceOnly, 1, null, NOW, undefined, []);

            // The suggestion inputs change nothing about the evidence reading.
            expect(glance.safetyState).toEqual(baseline.safetyState);
            expect(glance.evidence).toEqual(baseline.evidence);
            expect(glance.freshness).toEqual(baseline.freshness);

            // The label tracks live suggestions verbatim (provenance stays
            // visible): any batched suggested attribute keeps it on; the
            // celiac fallback flag stays live only while the celiac claim
            // itself has no votes.
            const celiacStillLive = celiacSuggested && confirmCount + disputeCount === 0;
            expect(glance.suggestedByBot).toBe(suggestedAttributes.length > 0 || celiacStillLive);
            // And the label is always exactly "suggestedAttributes is non-empty"
            // — the badges and the label can never disagree.
            expect(glance.suggestedByBot).toBe(glance.suggestedAttributes.length > 0);
          }
        }
      }
    }
  });

  it("a listing with NO celiac claim still surfaces a live non-celiac suggestion honestly", () => {
    const glance = deriveListingTrustGlance(null, 0, null, NOW, undefined, ["dedicated_fryer"]);
    expect(glance.suggestedByBot).toBe(true);
    expect(glance.suggestedAttributes).toEqual(["dedicated_fryer"]);
    // No fabricated verdict: the suggestion decorates the honest empty state.
    expect(glance.safetyState).toBeNull();
    expect(glance.evidence).toBeNull();
  });

  it("a voted-out celiac suggestion never badges the card via the FALLBACK flag (the vote cleared it)", () => {
    // The celiac claim was suggested, then voted: `suggested` may still read
    // true on a stale aggregate snapshot, but the fold-in is per-claim gated on
    // "no votes on that claim", so the badge honestly disappears. Scope: this
    // exercises the pure fallback path only; the batched per-attribute set is
    // vote-gated in SQL too (the correlated NOT EXISTS attestations guard in
    // `getBotSuggestedAttributesByListing`, pinned in browse.test.ts), so a
    // voted claim cannot enter `suggestedAttributes` from that path either —
    // even inside castVote's non-atomic clear window.
    const glance = deriveListingTrustGlance(
      { ...aggregate(3, 0, new Date(NOW.getTime() - DAY_MS)), suggested: true },
      3,
      null,
      NOW,
      undefined,
      []
    );
    expect(glance.suggestedByBot).toBe(false);
    expect(glance.suggestedAttributes).toEqual([]);
    expect(glance.safetyState).toBe("celiac-safe");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Invariant 4 — staleness flags, never hides (ADR-007: a claim not confirmed
// within the admin-tunable window gets a "may be stale" treatment — it is
// surfaced, not removed). Invariant 3 (one-per-user) is server/DB-side; see
// the integration suite.
// ───────────────────────────────────────────────────────────────────────────

describe("INVARIANT 4 — staleness FLAGS a claim, never hides/removes it", () => {
  it("a stale claim still renders its full summary (counts + recency stay visible)", () => {
    // Property-style: for every count combo with a confirmation past the window,
    // the summary still carries the same visible distribution — staleness only
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
        // Evidence is not hidden by staleness:
        expect(summary.confirmCount).toBe(confirmCount);
        expect(summary.disputeCount).toBe(disputeCount);
        expect(summary.countsLabel).toBe(`${confirmCount} confirm / ${disputeCount} dispute`);
        expect(summary.hasEvidence).toBe(confirmCount + disputeCount > 0);
      }
    }
  });

  it("a confirm-majority stale claim surfaces the `stale` headline state (flagged, not dropped)", () => {
    // A fresh-enough confirm-majority is "celiac-safe"; once it ages past the
    // window the same evidence is surfaced as "stale" — never null/hidden.
    const fresh = aggregate(5, 1, new Date(NOW.getTime() - DAY_MS));
    const stale = aggregate(5, 1, new Date(NOW.getTime() - (6 * MONTH_MS + DAY_MS)));
    expect(deriveHeadlineSafetyState(fresh, NOW)).toBe("celiac-safe");
    expect(deriveHeadlineSafetyState(stale, NOW)).toBe("stale");
  });

  it("does NOT hand a contested claim the `stale` chip (contested-first, AUB-295)", () => {
    // `lastConfirmedAt` only ever moves on a confirm, so a claim confirmed long
    // ago and heavily disputed since looks "stale" by recency alone. Reading it
    // as `stale` would dress a live dispute majority up as a neutral "needs a
    // refresh". The contested check runs first, so the badge is suppressed
    // outright — and the same holds for a contested claim that is still fresh.
    const staleAndContested = aggregate(1, 10, new Date(NOW.getTime() - 12 * MONTH_MS));
    const freshAndContested = aggregate(1, 10, new Date(NOW.getTime() - DAY_MS));
    expect(isStale(staleAndContested.lastConfirmedAt, NOW)).toBe(true); // recency IS aged…
    expect(deriveHeadlineSafetyState(staleAndContested, NOW)).toBeNull(); // …but no chip
    expect(deriveHeadlineSafetyState(freshAndContested, NOW)).toBeNull();
  });

  it("honours the admin-tunable window (default 6 months) — boundary is inclusive-fresh", () => {
    // ADR-007: the window is an admin-tunable AppSetting; the default is 6
    // months. A confirmation exactly on the edge is fresh; strictly older is
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
// Invariant 6 — a dispute can only ever SUPPRESS a signal (owner decision
// 2026-08-25). There is no "gluten-friendly" consolation state: a tie or a
// dispute majority yields `null` — the same nothing an unattested claim
// yields, and the same empty glance (no badge, no freshness cue, no evidence
// meta). The guarantee a celiac relies on is one-directional: adding disputes
// never affirms, never softens, never upgrades. The counts stay visible on the
// detail-page claim row, so the contest is never hidden, only un-badged.
// ───────────────────────────────────────────────────────────────────────────

describe("INVARIANT 6 — a tie or dispute-majority NEVER yields a safety badge", () => {
  it("returns null for EVERY contested aggregate across the count × recency grid", () => {
    // Property-style: every (confirm, dispute) pair where disputes tie or lead,
    // at every recency including null. Not one of them may produce
    // "celiac-safe" or "stale". A `>` relaxed to `>=` anywhere in the
    // derivation lights this up immediately.
    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID) {
        if (disputeCount < confirmCount) {
          continue; // confirms lead — not a contested case
        }
        for (const ageMs of [...AGE_GRID_MS, null]) {
          const lastConfirmedAt = ageMs === null ? null : new Date(NOW.getTime() - ageMs);
          const agg = aggregate(confirmCount, disputeCount, lastConfirmedAt);
          const state = deriveHeadlineSafetyState(agg, NOW);

          expect(state, `${confirmCount}c/${disputeCount}d @ ${String(ageMs)}`).toBeNull();
          expect(state).not.toBe("celiac-safe");
          expect(state).not.toBe("stale");
        }
      }
    }
  });

  it("renders a DISPUTED claim identically to an UNATTESTED one (indistinguishable by design)", () => {
    // The owner decision, stated as an equality rather than an absence: the
    // product deliberately does not tell a user "the community says this is NOT
    // celiac-safe". Every headline-facing derivation must agree.
    const unattested = aggregate(0, 0, null);
    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID.filter((d) => d >= confirmCount && d > 0)) {
        const disputed = aggregate(confirmCount, disputeCount, new Date(NOW.getTime() - DAY_MS));

        expect(deriveHeadlineSafetyState(disputed, NOW)).toBe(
          deriveHeadlineSafetyState(unattested, NOW)
        );
        expect(safetyTierRank(disputed, NOW)).toBe(safetyTierRank(unattested, NOW));
        expect(deriveListingTrustGlance(disputed, 1, null, NOW).safetyState).toBe(
          deriveListingTrustGlance(unattested, 0, null, NOW).safetyState
        );
      }
    }
  });

  it("is MONOTONIC in disputes: adding a dispute never upgrades the state or the rank", () => {
    // Property-style: hold confirms + recency fixed and walk disputes upward.
    // The sort rank must be non-increasing at every step, and the state may
    // only ever move celiac-safe/stale → null, never the other way. A weighting
    // change that let a big dispute count "balance out" into a higher tier
    // breaks here.
    for (const confirmCount of COUNT_GRID) {
      for (const ageMs of [...AGE_GRID_MS, null]) {
        const lastConfirmedAt = ageMs === null ? null : new Date(NOW.getTime() - ageMs);
        let previousRank = Number.POSITIVE_INFINITY;
        let previousState: string | null | undefined;

        for (let disputeCount = 0; disputeCount <= 30; disputeCount += 1) {
          const agg = aggregate(confirmCount, disputeCount, lastConfirmedAt);
          const rank = safetyTierRank(agg, NOW);
          const state = deriveHeadlineSafetyState(agg, NOW);

          expect(
            rank,
            `${confirmCount}c/${disputeCount}d @ ${String(ageMs)}: rank must not rise`
          ).toBeLessThanOrEqual(previousRank);
          // Once suppressed, more disputes can never bring a badge back.
          if (previousState === null) {
            expect(state, `${confirmCount}c/${disputeCount}d: badge came back`).toBeNull();
          }
          previousRank = rank;
          previousState = state;
        }
      }
    }
  });

  it("never emits the retired tier 2 — the sort cannot distinguish contested from unattested", () => {
    // Tier 2 was "gluten-friendly". Re-introducing it would mean the browse
    // sort ranks a disputed listing differently from an unattested one, while
    // the two cards look identical — a hidden ordering the user cannot
    // reproduce from the visible evidence (ADR-007).
    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID) {
        for (const ageMs of [...AGE_GRID_MS, null]) {
          const lastConfirmedAt = ageMs === null ? null : new Date(NOW.getTime() - ageMs);
          const rank = safetyTierRank(aggregate(confirmCount, disputeCount, lastConfirmedAt), NOW);
          expect([1, 3, 4], `${confirmCount}c/${disputeCount}d @ ${String(ageMs)}`).toContain(rank);
        }
      }
    }
    expect(safetyTierRank(null, NOW)).toBe(1);
    expect(safetyTierRank(undefined, NOW)).toBe(1);
  });

  it("makes the CONTESTED glance indistinguishable from the UNATTESTED glance", () => {
    // The scoping half of the decision, at the surface a browsing celiac
    // actually reads. Suppressing the badge alone is not enough: a freshness
    // cue ("Verified 3d ago", in celiac-safe green) or an evidence meta ("8
    // confirmations · 9 neighbors") beside an empty badge slot is a cue an
    // unattested card cannot show, so either one turns "no verdict" into a
    // legible downgrade the community never voted for. All three must be
    // absent together.
    const unattestedGlance = deriveListingTrustGlance(aggregate(0, 0, null), 0, null, NOW);

    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID.filter((d) => d >= confirmCount && d > 0)) {
        for (const ageMs of [...AGE_GRID_MS, null]) {
          const lastConfirmedAt = ageMs === null ? null : new Date(NOW.getTime() - ageMs);
          const agg = aggregate(confirmCount, disputeCount, lastConfirmedAt);
          const glance = deriveListingTrustGlance(agg, confirmCount + disputeCount, null, NOW);
          const where = `${confirmCount}c/${disputeCount}d @ ${String(ageMs)}`;

          expect(glance.safetyState, where).toBeNull();
          expect(glance.freshness, where).toBeNull();
          expect(glance.evidence, where).toBeNull();

          // Stated as the equality the decision actually claims, not three
          // separate absences: the two glances are the same reading.
          expect(glance.safetyState, where).toBe(unattestedGlance.safetyState);
          expect(glance.freshness, where).toBe(unattestedGlance.freshness);
          expect(glance.evidence, where).toBe(unattestedGlance.evidence);
        }
      }
    }
  });

  it("SUPPRESSES the glance without HIDING the evidence — claim-row counts stay visible", () => {
    // The other half of the decision: no badge is not the same as no
    // information. The dispute that removed the badge must still be countable
    // on the detail-page claim row, or the app would be concealing the contest
    // rather than declining to adjudicate it. `summarizeClaim` is deliberately
    // outside the suppression rule — it is the one surface that keeps counts.
    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID.filter((d) => d >= confirmCount && d > 0)) {
        const agg = aggregate(confirmCount, disputeCount, new Date(NOW.getTime() - DAY_MS));
        const summary = summarizeClaim("celiac_safe_vs_gluten_friendly", agg, NOW);

        expect(deriveHeadlineSafetyState(agg, NOW)).toBeNull(); // no badge…
        expect(summary.confirmCount).toBe(confirmCount); // …but full counts
        expect(summary.disputeCount).toBe(disputeCount);
        expect(summary.countsLabel).toBe(`${confirmCount} confirm / ${disputeCount} dispute`);
        expect(summary.hasEvidence).toBe(true);
      }
    }
  });

  it("exempts INCIDENTS from the suppression — recent harm still reaches the card", () => {
    // The suppression withholds a verdict the app will not make; it must never
    // withhold a warning the community DID make. A contested listing with a
    // recent "got glutened" report keeps both the flag and the incident-phrased
    // freshness cue, even though its confirmation recency is suppressed.
    const incidentAt = new Date(NOW.getTime() - 2 * DAY_MS);
    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID.filter((d) => d >= confirmCount && d > 0)) {
        const agg = aggregate(confirmCount, disputeCount, new Date(NOW.getTime() - DAY_MS));
        const glance = deriveListingTrustGlance(agg, 1, incidentAt, NOW);

        expect(glance.safetyState).toBeNull();
        expect(glance.evidence).toBeNull();
        expect(glance.hasRecentIncident).toBe(true);
        expect(glance.freshness?.kind).toBe("incident");
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Invariant 7 — no filter may surface a contested claim as a match. The
// directory's quick filters are defined as `safetyState === "celiac-safe"`
// (`celiac`) and `freshness.kind === "fresh"` (`recent`), and the taxonomy
// filter as `hasPositiveConsensus` (app/listings/quick.ts,
// app/trust/browse-glance.ts, app/trust/summary.ts). All three are the rules
// the server-side SQL mirrors; the SQL's faithfulness to them is pinned
// structurally in `app/server/listings/quick-filter.test.ts` and
// `app/server/listings/browse.test.ts`. Here we pin the rules themselves as
// properties: a filtered result set can never contain a listing whose card
// shows no badge, because that is a match the user cannot reproduce from the
// visible evidence — and a celiac could be hurt by it. `recent` is in scope
// precisely because the contested glance carries no freshness cue: without
// that, "Recently verified" would return badge-less cards.
// ───────────────────────────────────────────────────────────────────────────

describe("INVARIANT 7 — a filter never matches a claim whose disputes >= confirms", () => {
  it("the celiac quick-filter rule (safetyState === 'celiac-safe') refuses every contested claim", () => {
    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID.filter((d) => d >= confirmCount)) {
        for (const ageMs of [...AGE_GRID_MS, null]) {
          const lastConfirmedAt = ageMs === null ? null : new Date(NOW.getTime() - ageMs);
          const agg = aggregate(confirmCount, disputeCount, lastConfirmedAt);
          const matchesCeliacQuickFilter = deriveHeadlineSafetyState(agg, NOW) === "celiac-safe";
          expect(
            matchesCeliacQuickFilter,
            `${confirmCount}c/${disputeCount}d @ ${String(ageMs)}`
          ).toBe(false);
        }
      }
    }
  });

  it("the recent quick-filter rule (freshness.kind === 'fresh') refuses every contested claim", () => {
    // The second half of "a filter never returns a badge-less card". A
    // contested claim's confirmation recency is suppressed with its badge, so
    // there is no `fresh` cue left for this filter to match — including the
    // case that motivates the rule: confirmed recently, then disputed into a
    // tie, where the raw timestamp still looks fresh.
    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID.filter((d) => d >= confirmCount && d > 0)) {
        for (const ageMs of AGE_GRID_MS) {
          const agg = aggregate(confirmCount, disputeCount, new Date(NOW.getTime() - ageMs));
          const glance = deriveListingTrustGlance(agg, 1, null, NOW);
          const matchesRecentQuickFilter = glance.freshness?.kind === "fresh";

          expect(
            matchesRecentQuickFilter,
            `${confirmCount}c/${disputeCount}d @ ${String(ageMs)}`
          ).toBe(false);
        }
      }
    }
  });

  it("never returns a badge-less card from EITHER quick filter", () => {
    // Stated as the guarantee the invariant is named for, over the full grid:
    // whenever a listing matches `celiac` or `recent`, its card is showing a
    // safety badge the user can read. A match a user cannot reproduce from the
    // visible card is the failure mode this pins shut.
    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID) {
        for (const ageMs of [...AGE_GRID_MS, null]) {
          const lastConfirmedAt = ageMs === null ? null : new Date(NOW.getTime() - ageMs);
          const agg = aggregate(confirmCount, disputeCount, lastConfirmedAt);
          const glance = deriveListingTrustGlance(agg, 1, null, NOW);
          const where = `${confirmCount}c/${disputeCount}d @ ${String(ageMs)}`;

          if (glance.safetyState === "celiac-safe" || glance.freshness?.kind === "fresh") {
            expect(glance.safetyState, where).not.toBeNull();
          }
        }
      }
    }
  });

  it("the taxonomy filter rule (hasPositiveConsensus) agrees — a tie is not an affirmation", () => {
    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID) {
        const positive = hasPositiveConsensus({ confirmCount, disputeCount });
        // Strict: confirms must OUTNUMBER disputes, and there must be evidence.
        expect(positive, `${confirmCount}c/${disputeCount}d`).toBe(
          confirmCount > disputeCount && confirmCount + disputeCount > 0
        );
        if (disputeCount >= confirmCount) {
          expect(positive).toBe(false);
        }
      }
    }
  });

  it("keeps the two filter rules in lockstep on the contested boundary", () => {
    // Where the headline reads celiac-safe, the taxonomy rule must agree the
    // consensus is positive — one `confirmCount > disputeCount` rule, two call
    // sites. (The converse does not hold: a stale-but-uncontested claim is
    // positive consensus without a celiac-safe headline, deliberately.)
    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID) {
        const agg = aggregate(confirmCount, disputeCount, new Date(NOW.getTime() - DAY_MS));
        if (deriveHeadlineSafetyState(agg, NOW) === "celiac-safe") {
          expect(hasPositiveConsensus(agg), `${confirmCount}c/${disputeCount}d`).toBe(true);
        }
      }
    }
  });

  it("closes the bot-suggestion back door: any vote kills the suggestion match", () => {
    // The `celiac` quick filter also matches a live, unvoted curator-bot
    // suggestion (dateless provenance). That branch is gated on ZERO votes —
    // which is what stops a disputed claim from re-entering the filter through
    // it. If the gate were loosened to "no confirms", a bot-suggested claim
    // that the community had disputed would match the celiac filter: the exact
    // false match this invariant exists to prevent.
    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID) {
        const summary = summarizeClaim(
          "celiac_safe_vs_gluten_friendly",
          {
            ...aggregate(confirmCount, disputeCount, null),
            suggested: true,
          },
          NOW
        );
        // The suggestion is live only while the claim has no votes at all.
        expect(summary.suggested, `${confirmCount}c/${disputeCount}d`).toBe(
          confirmCount + disputeCount === 0
        );
        if (disputeCount > 0) {
          expect(summary.suggested, "a disputed claim must never read as suggested").toBe(false);
        }
      }
    }
  });

  it("a suggestion is never evidence: it cannot manufacture a badge on a contested claim", () => {
    // Belt and braces on invariant 2b, aimed at the contested case
    // specifically: flipping `suggested` on must not move the verdict off
    // `null` for a claim whose disputes tie or lead.
    for (const confirmCount of COUNT_GRID) {
      for (const disputeCount of COUNT_GRID.filter((d) => d >= confirmCount && d > 0)) {
        const evidenceOnly = aggregate(
          confirmCount,
          disputeCount,
          new Date(NOW.getTime() - DAY_MS)
        );
        const withSuggestion = { ...evidenceOnly, suggested: true };

        expect(deriveListingTrustGlance(withSuggestion, 1, null, NOW).safetyState).toBeNull();
        expect(deriveListingTrustGlance(withSuggestion, 1, null, NOW).safetyState).toBe(
          deriveListingTrustGlance(evidenceOnly, 1, null, NOW).safetyState
        );
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Invariant 5 (dedup half) — ADR-008 intake: Place ID is the dedup key, and
// the manual-entry fallback path is reachable (not dead code). The DB-level
// UNIQUE(place_id) is pinned in the integration suite; the pure manual-dedup
// safeguard lives in `app/server/listings/intake-dedup.invariant.test.ts`,
// which can value-import the server-only dedup module.
// (browse-glance/summary/incident invariants stay client-safe in this file.)
// ───────────────────────────────────────────────────────────────────────────
