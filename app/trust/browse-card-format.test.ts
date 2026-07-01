import { describe, expect, it } from "vitest";
import { formatDistanceLabel, formatFreshness } from "./browse-card-format";

/**
 * Unit tests for the pure browse-card presentation formatters (AUB-61 Phase 2a).
 *
 * Both functions are pure/deterministic — `formatFreshness` takes `now` so we can
 * pin every branch (incident → fresh → stale precedence) and the exact boundary
 * at the staleness window; `formatDistanceLabel` is a straight unit conversion.
 */

const NOW = new Date("2026-06-28T12:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("formatFreshness", () => {
  it("returns null when there is no incident and no confirmation timestamp", () => {
    expect(formatFreshness(null, null, NOW, 6)).toBeNull();
  });

  it("renders a fresh 'Verified' cue for a within-window confirmation", () => {
    expect(formatFreshness(ago(3 * DAY), null, NOW, 6)).toEqual({
      kind: "fresh",
      label: "Verified 3d ago",
    });
  });

  it("treats a never-confirmed claim with no incident as no cue (null)", () => {
    // isStale(null) is false, but there is no timestamp to phrase → null.
    expect(formatFreshness(null, null, NOW, 6)).toBeNull();
  });

  it("renders a stale 'Updated' cue once the confirmation is strictly past the window", () => {
    // 7 months old at a 6-month window → stale.
    const cue = formatFreshness(ago(7 * MONTH), null, NOW, 6);
    expect(cue?.kind).toBe("stale");
    expect(cue?.label).toBe("Updated 7mo ago");
  });

  it("classifies a confirmation EXACTLY on the staleness edge as fresh (inclusive)", () => {
    // Exactly 6 * 30d old — the shared isStale boundary is inclusive (fresh).
    const cue = formatFreshness(ago(6 * MONTH), null, NOW, 6);
    expect(cue?.kind).toBe("fresh");
    expect(cue?.label).toBe("Verified 6mo ago");
  });

  it("classifies one instant past the edge as stale (boundary flip)", () => {
    const cue = formatFreshness(ago(6 * MONTH + DAY), null, NOW, 6);
    expect(cue?.kind).toBe("stale");
  });

  it("lets a recent incident win outright, phrased from the incident's own recency", () => {
    // Even with a fresh confirmation, the incident is the loudest cue.
    const cue = formatFreshness(ago(2 * DAY), ago(5 * DAY), NOW, 6);
    expect(cue).toEqual({ kind: "incident", label: "Reported 5d ago" });
  });

  it("shows the incident cue even when there is no confirmation timestamp", () => {
    expect(formatFreshness(null, ago(HOUR), NOW, 6)).toEqual({
      kind: "incident",
      label: "Reported 1h ago",
    });
  });

  it("buckets compact ages by minute/hour/day/month", () => {
    expect(formatFreshness(ago(30 * MINUTE), null, NOW, 6)?.label).toBe("Verified 30m ago");
    expect(formatFreshness(ago(5 * HOUR), null, NOW, 6)?.label).toBe("Verified 5h ago");
    expect(formatFreshness(ago(200 * DAY), null, NOW, 12)?.label).toBe("Verified 6mo ago");
  });

  it("clamps a future/near-now confirmation to 'just now' (no trailing 'ago')", () => {
    expect(formatFreshness(ago(10_000), null, NOW, 6)?.label).toBe("Verified just now");
  });
});

describe("formatDistanceLabel", () => {
  it("converts kilometres to one-decimal miles", () => {
    // ~0.644 km ≈ 0.4 mi.
    expect(formatDistanceLabel(0.643_738)).toBe("0.4 mi");
  });

  it("rounds to a single decimal place", () => {
    expect(formatDistanceLabel(1.609_344)).toBe("1.0 mi"); // exactly 1 mile
    expect(formatDistanceLabel(16.093_44)).toBe("10.0 mi");
  });

  it("renders 0.0 mi for a coincident point", () => {
    expect(formatDistanceLabel(0)).toBe("0.0 mi");
  });

  it("clamps a negative distance to 0.0 mi rather than a negative label", () => {
    expect(formatDistanceLabel(-5)).toBe("0.0 mi");
  });
});
