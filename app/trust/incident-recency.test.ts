import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RECENT_INCIDENT_WINDOW_DAYS,
  findRecentIncident,
  isRecentIncident,
  reportIncidentInputSchema,
  toCalendarDayString,
} from "./incident-recency";

/**
 * Tests for the pure, client-safe incident recency + validation helpers (#30).
 * No DB mocks needed — this module imports no database client.
 */

describe("reportIncidentInputSchema — validation", () => {
  it("requires occurredOn (date is required)", () => {
    const result = reportIncidentInputSchema.safeParse({ listingId: "listing-1" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-YYYY-MM-DD date", () => {
    const result = reportIncidentInputSchema.safeParse({
      listingId: "listing-1",
      occurredOn: "June 1 2026",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a date with no severity or note (both optional)", () => {
    const result = reportIncidentInputSchema.safeParse({
      listingId: "listing-1",
      occurredOn: "2026-06-01",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown severity", () => {
    const result = reportIncidentInputSchema.safeParse({
      listingId: "listing-1",
      occurredOn: "2026-06-01",
      severity: "deadly",
    });
    expect(result.success).toBe(false);
  });

  it("normalises a blank note to undefined", () => {
    const result = reportIncidentInputSchema.safeParse({
      listingId: "listing-1",
      occurredOn: "2026-06-01",
      note: "   ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBeUndefined();
    }
  });

  it("rejects a future-dated incident (cannot pin the banner forever)", () => {
    // Far enough out to be future regardless of when the suite runs.
    const result = reportIncidentInputSchema.safeParse({
      listingId: "listing-1",
      occurredOn: "2099-01-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /future/i.test(i.message))).toBe(true);
    }
  });

  it("rejects an invalid calendar date that matches the format (e.g. 2026-02-31)", () => {
    for (const bad of ["2026-02-31", "2026-13-45", "2026-00-00"]) {
      const result = reportIncidentInputSchema.safeParse({
        listingId: "listing-1",
        occurredOn: bad,
      });
      expect(result.success).toBe(false);
    }
  });

  it("accepts today's date (boundary of the no-future rule)", () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = reportIncidentInputSchema.safeParse({
      listingId: "listing-1",
      occurredOn: today,
    });
    expect(result.success).toBe(true);
  });
});

describe("isRecentIncident — window boundary", () => {
  const now = new Date("2026-06-28T12:00:00Z");

  it("counts an incident exactly at the window edge as recent (inclusive)", () => {
    const edge = new Date(now.getTime() - RECENT_INCIDENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const edgeIso = edge.toISOString().slice(0, 10);
    expect(isRecentIncident(edgeIso, now)).toBe(true);
  });

  it("counts an incident one day past the window as NOT recent", () => {
    const past = new Date(now.getTime() - (RECENT_INCIDENT_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
    const pastIso = past.toISOString().slice(0, 10);
    expect(isRecentIncident(pastIso, now)).toBe(false);
  });

  it("does NOT count a future-dated incident as recent (defense in depth)", () => {
    expect(isRecentIncident("2026-12-31", now)).toBe(false);
  });

  it("returns false for an unparseable date", () => {
    expect(isRecentIncident("not-a-date", now)).toBe(false);
  });

  it("returns false for an invalid calendar date that matches the format", () => {
    expect(isRecentIncident("2026-02-31", now)).toBe(false);
  });
});

describe("findRecentIncident — picks the most recent within the window", () => {
  const now = new Date("2026-06-28T12:00:00Z");

  it("returns the most recent incident when one is within the window", () => {
    const result = findRecentIncident(
      [
        { occurredOn: "2026-06-20", id: "fresh" },
        { occurredOn: "2026-01-01", id: "old" },
      ],
      now
    );
    expect(result?.id).toBe("fresh");
  });

  it("returns null when every incident is outside the window", () => {
    const result = findRecentIncident([{ occurredOn: "2025-01-01", id: "ancient" }], now);
    expect(result).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(findRecentIncident([], now)).toBeNull();
  });
});

describe("toCalendarDayString — driver date normalization (issue #45)", () => {
  it("returns an already-canonical YYYY-MM-DD string unchanged", () => {
    expect(toCalendarDayString("2026-06-28")).toBe("2026-06-28");
  });

  it("converts the driver's local-midnight Date for a `date` column to its YYYY-MM-DD", () => {
    // The Neon HTTP driver (pg-types, OID 1082) builds a `date` as a Date at
    // LOCAL midnight — `new Date(y, m-1, d)`, month 0-based → June 28. Reading
    // it back with LOCAL getters recovers the stored calendar day (#144).
    expect(toCalendarDayString(new Date(2026, 5, 28))).toBe("2026-06-28");
  });

  it("pads single-digit month/day to two digits", () => {
    expect(toCalendarDayString(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("its output round-trips back through the recency check as recent", () => {
    const now = new Date("2026-06-28T12:00:00Z");
    const normalized = toCalendarDayString(new Date(2026, 5, 28));
    expect(isRecentIncident(normalized, now)).toBe(true);
  });

  it("returns a genuinely unparseable value coerced to string rather than fabricating a date", () => {
    expect(toCalendarDayString("not-a-date")).toBe("not-a-date");
  });
});

describe("toCalendarDayString — positive-offset TZ regression (issue #144)", () => {
  // Force a positive-offset runtime so a UTC-getter regression (which would
  // yield the day BEFORE the stored one) is caught WITHOUT the DB-gated
  // integration test. Setting `process.env.TZ` is test tooling (the one allowed
  // exception to the no-`process.env` rule); newly constructed Dates pick it up.
  // Default to UTC (the prod/CI invariant) when TZ is unset so we always restore
  // to a sane, non-positive offset rather than reintroducing a stray "undefined".
  const originalTz = process.env.TZ ?? "UTC";
  beforeAll(() => {
    process.env.TZ = "Asia/Tokyo";
  });
  afterAll(() => {
    // Restore so no other suite inherits the forced TZ.
    process.env.TZ = originalTz;
  });

  it("recovers the stored calendar day from the driver's local-midnight Date under Asia/Tokyo", () => {
    // Sanity-check the harness actually applied the positive offset: under
    // Asia/Tokyo the UTC getters of this local-midnight Date land on the prior
    // day, which is exactly the bug local getters fix.
    const localMidnight = new Date(2026, 5, 28);
    expect(localMidnight.getUTCDate()).toBe(27);

    // Local getters must still return the STORED day, not the UTC-shifted one.
    expect(toCalendarDayString(localMidnight)).toBe("2026-06-28");
  });

  it("keeps a January date correct (year/month boundary) under Asia/Tokyo", () => {
    expect(toCalendarDayString(new Date(2026, 0, 1))).toBe("2026-01-01");
  });
});
