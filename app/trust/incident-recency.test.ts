import workerThreads from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  editIncidentInputSchema,
  findRecentIncident,
  isRecentIncident,
  parseCalendarDay,
  RECENT_INCIDENT_WINDOW_DAYS,
  reportIncidentInputSchema,
  toCalendarDayString,
} from "./incident-recency";

/**
 * Tests for the pure, client-safe incident recency + validation helpers (#30).
 * No DB mocks needed — this module imports no database client.
 */

describe("parseCalendarDay — the calendar-date contract", () => {
  it("returns the UTC midnight of a real calendar day", () => {
    expect(parseCalendarDay("2026-06-28")).toBe(Date.UTC(2026, 5, 28));
  });

  it("rejects a value with anything around the date (a timestamp is not a calendar day)", () => {
    // The contract is a BARE YYYY-MM-DD, anchored at both ends. Matching a
    // prefix or suffix would let an ISO timestamp through the report validator
    // into the `date` column, and would stop `toCalendarDayString` from
    // normalising one at the read boundary (#45).
    expect(parseCalendarDay("2026-06-28T00:00:00.000Z")).toBeNull();
    expect(parseCalendarDay("2026-06-2899")).toBeNull();
    expect(parseCalendarDay("on 2026-06-28")).toBeNull();
  });

  it("rejects a day JS would silently roll forward into the next month", () => {
    expect(parseCalendarDay("2026-02-31")).toBeNull(); // -> Mar 3
    expect(parseCalendarDay("2026-04-31")).toBeNull(); // -> May 1
    expect(parseCalendarDay("2026-01-00")).toBeNull(); // -> Dec 31 2025
  });

  it("rejects an out-of-range month", () => {
    expect(parseCalendarDay("2026-13-05")).toBeNull();
    expect(parseCalendarDay("2026-00-05")).toBeNull();
  });

  it("rejects a pre-1000 year that Date.UTC would reinterpret as 19xx", () => {
    // `Date.UTC(99, 0, 1)` is 1999-01-01, not 0099-01-01 — the legacy two-digit
    // year mapping. Without the YEAR half of the round-trip check this parses to
    // an instant ~1900 years off the input, which the no-future rule then
    // happily accepts and stores.
    expect(parseCalendarDay("0099-01-01")).toBeNull();
    expect(parseCalendarDay("0001-01-01")).toBeNull();
  });
});

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
    if (result.success) {
      // An OMITTED note must keep validating (zod 4 regression guard: the
      // `.transform(...).optional()` chain must keep the key omittable) and
      // parse to undefined, never a required key the caller must spell out.
      expect(result.data.note).toBeUndefined();
      expect(result.data.severity).toBeUndefined();
    }
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

  it("explains an impossible date as an impossible date, not as a future one", () => {
    // `IncidentReports` renders the failed mutation's message verbatim, so the
    // reason a report bounced has to match what the reporter actually typed —
    // telling someone who entered Feb 31 that their date "cannot be in the
    // future" is unactionable.
    const result = reportIncidentInputSchema.safeParse({
      listingId: "listing-1",
      occurredOn: "2026-02-31",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /real YYYY-MM-DD date/.test(i.message))).toBe(true);
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

describe("editIncidentInputSchema — the edit path re-validates the date (#32)", () => {
  it("accepts an id with a real, past occurredOn", () => {
    const result = editIncidentInputSchema.safeParse({
      id: "incident-1",
      occurredOn: "2026-06-01",
    });
    expect(result.success).toBe(true);
  });

  it("accepts today's date (boundary of the no-future rule)", () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = editIncidentInputSchema.safeParse({ id: "incident-1", occurredOn: today });
    expect(result.success).toBe(true);
  });

  it("rejects an edit to a future date (an edit cannot sneak past the report rules)", () => {
    // Without this, editing an incident's date forward would pin the recent-
    // incident banner on the listing indefinitely.
    const result = editIncidentInputSchema.safeParse({
      id: "incident-1",
      occurredOn: "2099-01-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /future/i.test(i.message))).toBe(true);
    }
  });

  it("rejects an edit to an impossible calendar date, and says which problem it is", () => {
    const result = editIncidentInputSchema.safeParse({
      id: "incident-1",
      occurredOn: "2026-02-31",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /real YYYY-MM-DD date/.test(i.message))).toBe(true);
    }
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

  it("returns the NEWEST in-window incident whatever order the list arrives in", () => {
    // The banner has to describe the freshest report: it scans for the maximum
    // itself rather than trusting the caller's ordering, so an unsorted list
    // (or one ordered oldest-first) must not surface a stale incident.
    const result = findRecentIncident(
      [
        { occurredOn: "2026-06-10", id: "middle" },
        { occurredOn: "2026-06-25", id: "newest" },
        { occurredOn: "2026-05-01", id: "oldest" },
      ],
      now
    );
    expect(result?.id).toBe("newest");
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

  it("reduces a full ISO timestamp string to its calendar day (never passes one through)", () => {
    // A Date that has been through a JSON/RPC round-trip arrives here as an ISO
    // timestamp string. It must be normalised to the bare calendar day the rest
    // of the app contracts on — handing the timestamp back verbatim makes every
    // downstream `parseCalendarDay` return null, which is exactly the #45 bug
    // (the recent-incident banner silently never renders). Noon UTC so the
    // local-getter read lands on the same day in any runtime TZ.
    expect(toCalendarDayString("2026-06-28T12:00:00.000Z")).toBe("2026-06-28");
  });

  it("returns a genuinely unparseable value coerced to string rather than fabricating a date", () => {
    expect(toCalendarDayString("not-a-date")).toBe("not-a-date");
  });
});

// Reassigning `process.env.TZ` at runtime is only honored by a fresh child
// process — vitest's default `forks` pool (used by `pnpm test`/preflight) and
// the real CI. Inside a worker_thread the V8 timezone cache is already warm and
// does NOT re-read TZ, so this positive-offset block CANNOT exercise its
// regression there (reproduces with `vitest run --pool=threads`). Stryker's
// vitest-runner hard-codes the threads pool, so we skip ONLY this TZ block under
// worker threads, detected via `!worker_threads.isMainThread`: it is `false` in a
// forks child (the block runs as normal) and `true` in a threads worker (the
// block skips). The rest of the suite still runs under Stryker, so
// incident-recency.ts stays mutation-covered.
const isWorkerThread = !workerThreads.isMainThread;
describe.skipIf(isWorkerThread)(
  "toCalendarDayString — positive-offset TZ regression (issue #144)",
  () => {
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
  }
);
