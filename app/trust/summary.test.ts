import { describe, expect, it } from "vitest";
import {
  CLAIM_ATTRIBUTE_LABELS,
  DEFAULT_STALENESS_MONTHS,
  claimAttributeLabel,
  deriveHeadlineSafetyState,
  formatLastConfirmed,
  formatRelativeTime,
  formatVoteCounts,
  hasEvidence,
  hasPositiveConsensus,
  isStale,
  summarizeClaim,
  totalVotes,
} from "./summary";

/**
 * Unit tests for the transparent trust roll-up derivation (#29, ADR-007).
 *
 * The whole point is that every value is a reproducible reading of VISIBLE
 * evidence (confirm/dispute counts + recency) — never a hidden score. These
 * tests pin the count formatting, relative-time rendering, staleness, and the
 * celiac-safe vs gluten-friendly headline derivation (including the no-evidence
 * empty case, which must stay honest — a celiac could be hurt by a fabricated
 * verdict).
 */

const NOW = new Date("2026-06-28T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

describe("claimAttributeLabel", () => {
  it("maps each taxonomy attribute to a human label", () => {
    expect(claimAttributeLabel("dedicated_fryer")).toBe("Dedicated fryer");
    expect(claimAttributeLabel("celiac_safe_vs_gluten_friendly")).toBe(
      "Celiac-safe vs. gluten-friendly"
    );
  });

  it("has a label for every attribute (exhaustive)", () => {
    for (const label of Object.values(CLAIM_ATTRIBUTE_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("formatVoteCounts", () => {
  it("shows both sides of the distribution", () => {
    expect(formatVoteCounts({ confirmCount: 8, disputeCount: 1 })).toBe("8 confirm / 1 dispute");
  });

  it("always shows zeroes (never hides a side)", () => {
    expect(formatVoteCounts({ confirmCount: 0, disputeCount: 0 })).toBe("0 confirm / 0 dispute");
    expect(formatVoteCounts({ confirmCount: 3, disputeCount: 0 })).toBe("3 confirm / 0 dispute");
  });
});

describe("totalVotes / hasEvidence", () => {
  it("totals confirm + dispute", () => {
    expect(totalVotes({ confirmCount: 8, disputeCount: 1 })).toBe(9);
  });

  it("hasEvidence is false only when both counts are zero", () => {
    expect(hasEvidence({ confirmCount: 0, disputeCount: 0 })).toBe(false);
    expect(hasEvidence({ confirmCount: 1, disputeCount: 0 })).toBe(true);
    expect(hasEvidence({ confirmCount: 0, disputeCount: 1 })).toBe(true);
  });
});

describe("formatRelativeTime", () => {
  it("returns null for a null instant (never confirmed)", () => {
    expect(formatRelativeTime(null, NOW)).toBeNull();
  });

  it("renders 'just now' for sub-minute and future (clock-skew) instants", () => {
    expect(formatRelativeTime(ago(10_000), NOW)).toBe("just now");
    // Future timestamp clamps to 'just now' rather than "in N".
    expect(formatRelativeTime(new Date(NOW.getTime() + HOUR), NOW)).toBe("just now");
  });

  it("renders minutes and hours", () => {
    expect(formatRelativeTime(ago(5 * MINUTE), NOW)).toBe("5 minutes ago");
    expect(formatRelativeTime(ago(1 * MINUTE), NOW)).toBe("1 minute ago");
    expect(formatRelativeTime(ago(3 * HOUR), NOW)).toBe("3 hours ago");
  });

  it("renders 'yesterday' then days", () => {
    expect(formatRelativeTime(ago(1.5 * DAY), NOW)).toBe("yesterday");
    expect(formatRelativeTime(ago(3 * DAY), NOW)).toBe("3 days ago");
  });

  it("renders weeks (the canonical '3 weeks ago' example)", () => {
    expect(formatRelativeTime(ago(3 * WEEK), NOW)).toBe("3 weeks ago");
    expect(formatRelativeTime(ago(1 * WEEK), NOW)).toBe("1 week ago");
  });

  it("renders months and years", () => {
    expect(formatRelativeTime(ago(2 * MONTH), NOW)).toBe("2 months ago");
    expect(formatRelativeTime(ago(1 * MONTH), NOW)).toBe("1 month ago");
    expect(formatRelativeTime(ago(2 * YEAR), NOW)).toBe("2 years ago");
  });
});

describe("formatLastConfirmed", () => {
  it("prefixes the relative time with 'last confirmed'", () => {
    expect(formatLastConfirmed(ago(3 * WEEK), NOW)).toBe("last confirmed 3 weeks ago");
  });

  it("says 'not yet confirmed' when there is no timestamp (no fabrication)", () => {
    expect(formatLastConfirmed(null, NOW)).toBe("not yet confirmed");
  });
});

describe("isStale", () => {
  it("is false for a fresh confirmation", () => {
    expect(isStale(ago(2 * MONTH), NOW)).toBe(false);
  });

  it("is true past the default 6-month window", () => {
    expect(isStale(ago(7 * MONTH), NOW)).toBe(true);
  });

  it("is false for a never-confirmed claim (no recency to age out)", () => {
    expect(isStale(null, NOW)).toBe(false);
  });

  it("honours an admin-tuned window", () => {
    // 2 months old: stale under a 1-month window, fresh under the 6-month default.
    expect(isStale(ago(2 * MONTH), NOW, 1)).toBe(true);
    expect(isStale(ago(2 * MONTH), NOW, DEFAULT_STALENESS_MONTHS)).toBe(false);
  });
});

describe("summarizeClaim", () => {
  it("rolls a claim up into a render-ready summary", () => {
    const summary = summarizeClaim(
      "dedicated_fryer",
      { confirmCount: 8, disputeCount: 1, lastConfirmedAt: ago(3 * WEEK) },
      NOW
    );
    expect(summary).toEqual({
      attribute: "dedicated_fryer",
      label: "Dedicated fryer",
      confirmCount: 8,
      disputeCount: 1,
      countsLabel: "8 confirm / 1 dispute",
      recencyLabel: "last confirmed 3 weeks ago",
      hasEvidence: true,
      stale: false,
    });
  });

  it("flags an old confirmation as stale", () => {
    const summary = summarizeClaim(
      "dedicated_fryer",
      { confirmCount: 2, disputeCount: 0, lastConfirmedAt: ago(8 * MONTH) },
      NOW
    );
    expect(summary.stale).toBe(true);
  });

  it("marks a no-evidence claim honestly (no fabricated recency)", () => {
    const summary = summarizeClaim(
      "dedicated_fryer",
      { confirmCount: 0, disputeCount: 0, lastConfirmedAt: null },
      NOW
    );
    expect(summary.hasEvidence).toBe(false);
    expect(summary.recencyLabel).toBe("not yet confirmed");
    expect(summary.stale).toBe(false);
  });
});

describe("deriveHeadlineSafetyState — honest celiac-safe vs gluten-friendly", () => {
  it("returns null when there is NO evidence (keeps the 'Not yet attested' empty state)", () => {
    expect(
      deriveHeadlineSafetyState({ confirmCount: 0, disputeCount: 0, lastConfirmedAt: null }, NOW)
    ).toBeNull();
  });

  it("is celiac-safe when confirms strictly outnumber disputes (fresh)", () => {
    expect(
      deriveHeadlineSafetyState(
        { confirmCount: 8, disputeCount: 1, lastConfirmedAt: ago(3 * WEEK) },
        NOW
      )
    ).toBe("celiac-safe");
  });

  it("falls back to gluten-friendly when disputes tie or outnumber confirms (never overstate)", () => {
    expect(
      deriveHeadlineSafetyState(
        { confirmCount: 2, disputeCount: 2, lastConfirmedAt: ago(1 * WEEK) },
        NOW
      )
    ).toBe("gluten-friendly");
    expect(
      deriveHeadlineSafetyState(
        { confirmCount: 1, disputeCount: 5, lastConfirmedAt: ago(1 * WEEK) },
        NOW
      )
    ).toBe("gluten-friendly");
  });

  it("flags a stale consensus rather than trusting it as fresh", () => {
    // Strong confirm majority, but the last confirmation is past the window.
    expect(
      deriveHeadlineSafetyState(
        { confirmCount: 10, disputeCount: 0, lastConfirmedAt: ago(8 * MONTH) },
        NOW
      )
    ).toBe("stale");
  });

  it("never lets staleness mask a live dispute majority (contested-first)", () => {
    // Confirmed long ago (lastConfirmedAt only moves on confirms), then heavily
    // disputed since. A "may be stale" chip here would bury fresh contested
    // evidence — the dispute majority must win and read as gluten-friendly.
    expect(
      deriveHeadlineSafetyState(
        { confirmCount: 1, disputeCount: 10, lastConfirmedAt: ago(8 * MONTH) },
        NOW
      )
    ).toBe("gluten-friendly");
  });

  it("treats a dispute-only claim as gluten-friendly, not null (it has evidence)", () => {
    expect(
      deriveHeadlineSafetyState({ confirmCount: 0, disputeCount: 3, lastConfirmedAt: null }, NOW)
    ).toBe("gluten-friendly");
  });
});

describe("hasPositiveConsensus — the taxonomy filter match rule (#35)", () => {
  it("is false with no evidence (an unattested claim never matches)", () => {
    expect(hasPositiveConsensus({ confirmCount: 0, disputeCount: 0 })).toBe(false);
  });

  it("is true when confirms strictly outnumber disputes", () => {
    expect(hasPositiveConsensus({ confirmCount: 3, disputeCount: 1 })).toBe(true);
  });

  it("is false on a tie (contested evidence never reads as affirmed)", () => {
    expect(hasPositiveConsensus({ confirmCount: 2, disputeCount: 2 })).toBe(false);
  });

  it("is false when disputes outnumber confirms", () => {
    expect(hasPositiveConsensus({ confirmCount: 1, disputeCount: 5 })).toBe(false);
  });

  it("is false for a dispute-only claim", () => {
    expect(hasPositiveConsensus({ confirmCount: 0, disputeCount: 4 })).toBe(false);
  });

  it("agrees with deriveHeadlineSafetyState's confirm/dispute split", () => {
    // Wherever the headline reads celiac-safe (fresh confirm-majority), the
    // filter rule must agree the consensus is positive — same single rule.
    const fresh = { confirmCount: 5, disputeCount: 1, lastConfirmedAt: new Date() };
    expect(deriveHeadlineSafetyState(fresh)).toBe("celiac-safe");
    expect(hasPositiveConsensus(fresh)).toBe(true);
  });
});
