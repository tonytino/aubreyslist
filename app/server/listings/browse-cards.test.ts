import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GOLDEN regression test for `buildBrowseCards` (AUB-121).
 *
 * SAFETY-CRITICAL (ADR-007): `buildBrowseCards` owns the browse trust-glance
 * derivation — it batches the two visible-evidence signals (the headline celiac
 * aggregate + the recent-incident dates) and reduces each listing to a pure
 * {@link ListingTrustGlance}. This test PINS that output byte-for-byte across a
 * representative set of listings spanning EVERY trust state, so any future drift
 * in the glance mapping (a flipped tier, a lost evidence count, a changed
 * freshness cue, a mutated/dropped listing field) fails loudly here.
 *
 * It exercises the helper directly (not the DB-backed `getBrowseListings`) by
 * mocking `~/db/client` the SAME way `browse.test.ts` does — a `getDb()` whose
 * `select()` chains resolve to fixture rows — so we assert the assembled cards
 * without a live database (docs/agents/testing.md). `buildBrowseCards` issues
 * exactly two batched queries (celiac aggregate + incidents); the mock routes
 * each by its `select()` projection and returns the fixtures verbatim, so the
 * IN(...) filter is irrelevant to what a row maps to (the row's own `listingId`
 * keys it).
 *
 * The helper is DISTANCE-AGNOSTIC (the "0.4 mi" label lives in
 * `getBrowseListings`), so no distance is asserted here — that path stays pinned
 * in `browse.test.ts`.
 */

const h = vi.hoisted(() => {
  const state = {
    celiacRows: [] as Array<Record<string, unknown>>,
    incidentRows: [] as Array<Record<string, unknown>>,
  };

  // The celiac-aggregate chain: select(proj).from().leftJoin().where().groupBy()
  const aggGroupByMock = vi.fn(() => Promise.resolve(state.celiacRows));
  const aggWhereMock = vi.fn(() => ({ groupBy: aggGroupByMock }));
  const aggLeftJoinMock = vi.fn(() => ({ where: aggWhereMock }));
  const aggFromMock = vi.fn(() => ({ leftJoin: aggLeftJoinMock }));

  // The incidents chain: select(proj).from().where()  (awaited)
  const incidentWhereMock = vi.fn(() => Promise.resolve(state.incidentRows));
  const incidentFromMock = vi.fn(() => ({ where: incidentWhereMock }));

  // Route each query to the right chain by its select() projection:
  //  - has `occurredOn`       → incidents
  //  - otherwise (claim cols) → celiac aggregate
  const selectMock = vi.fn((projection?: Record<string, unknown>) => {
    if (projection && "occurredOn" in projection) return { from: incidentFromMock };
    return { from: aggFromMock };
  });

  return { state, selectMock };
});

vi.mock("~/db/client", () => ({
  getDb: () => ({ select: h.selectMock }),
}));

import type { Listing } from "~/db/schema";
import type { ListingTrustGlance } from "~/trust/browse-glance";
import { buildBrowseCards } from "./browse";

const { state } = h;
const NOW = new Date("2026-06-28T00:00:00Z");

/**
 * A full, valid `Listing` fixture. Every field is set (and asserted to pass
 * through the card verbatim) so the golden test also pins that `buildBrowseCards`
 * carries the listing through UNCHANGED — it never mutates, drops, or reshapes a
 * listing field.
 */
function mkListing(overrides: Partial<Listing> & Pick<Listing, "id" | "name">): Listing {
  return {
    placeId: `place-${overrides.id}`,
    address: "1 Main St",
    lat: 39.7392,
    lng: -104.9903,
    mapsUrl: `https://maps.example/${overrides.id}`,
    menuUrl: null,
    moderationStatus: "visible",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  state.celiacRows = [];
  state.incidentRows = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildBrowseCards (golden trust-glance derivation, ADR-007)", () => {
  it("returns no cards (and skips the signal queries) for an empty listing set", async () => {
    const cards = await buildBrowseCards([], NOW, 6);

    expect(cards).toEqual([]);
    // No batched query runs for an empty set (mirrors the empty-page guard).
    expect(h.selectMock).not.toHaveBeenCalled();
  });

  it("pins the card + glance for every trust state, in listing order", async () => {
    // A representative set spanning EVERY trust state the derivation can produce:
    //  - fresh celiac-safe   (fresh confirm-majority)
    //  - stale               (confirm-majority aged past the window)
    //  - contested           (disputes tie/lead → gluten-friendly)
    //  - recent-incident     (a recent report flags the card, incident cue wins)
    //  - unattested          (no celiac claim → honest empty state)
    const fresh = mkListing({ id: "l-fresh", name: "Fresh Cafe" });
    const stale = mkListing({ id: "l-stale", name: "Stale Diner" });
    const contested = mkListing({ id: "l-contested", name: "Contested Grill" });
    const incident = mkListing({ id: "l-incident", name: "Recently Hit" });
    const unattested = mkListing({ id: "l-unattested", name: "No Claims", menuUrl: "https://m" });

    const listings = [fresh, stale, contested, incident, unattested];

    // One grouped celiac-aggregate row per listing that HAS a celiac claim. The
    // unattested listing is deliberately absent (no row) → honest empty glance.
    state.celiacRows = [
      {
        listingId: "l-fresh",
        claimId: "c-fresh",
        lastConfirmedAt: new Date("2026-06-01T00:00:00Z"), // 27d ago → fresh
        confirmCount: "8",
        disputeCount: "1",
        contributors: "6",
      },
      {
        listingId: "l-stale",
        claimId: "c-stale",
        lastConfirmedAt: new Date("2025-12-01T00:00:00Z"), // 209d ago → stale (>180)
        confirmCount: "30",
        disputeCount: "0",
        contributors: "12",
      },
      {
        listingId: "l-contested",
        claimId: "c-contested",
        lastConfirmedAt: new Date("2026-06-20T00:00:00Z"), // 8d ago → fresh cue
        confirmCount: "2",
        disputeCount: "5", // disputes lead → gluten-friendly
        contributors: "7",
      },
      {
        listingId: "l-incident",
        claimId: "c-incident",
        lastConfirmedAt: new Date("2026-06-10T00:00:00Z"),
        confirmCount: "8",
        disputeCount: "0",
        contributors: "5",
      },
    ];
    // A recent (10d ago, inside the 90d window) incident on the incident listing.
    state.incidentRows = [{ listingId: "l-incident", occurredOn: "2026-06-18" }];

    const cards = await buildBrowseCards(listings, NOW, 6);

    // --- Order is preserved 1:1 with the input listings. -------------------
    expect(cards.map((c) => c.listing.id)).toEqual([
      "l-fresh",
      "l-stale",
      "l-contested",
      "l-incident",
      "l-unattested",
    ]);

    // --- Every listing is carried through UNCHANGED, all fields (no distanceLabel here). --
    expect(cards.map((c) => c.listing)).toEqual(listings);
    for (const card of cards) {
      expect(card).not.toHaveProperty("distanceLabel");
    }

    // --- The glance is pinned byte-for-byte for every trust state. ---------
    const glances = cards.map((c) => c.glance);

    const expected: ListingTrustGlance[] = [
      // fresh celiac-safe: fresh confirm-majority, evidence surfaced, "Verified".
      {
        safetyState: "celiac-safe",
        hasRecentIncident: false,
        evidence: { confirmations: 8, contributors: 6 },
        freshness: { kind: "fresh", label: "Verified 27d ago" },
        suggestedByBot: false,
      },
      // stale: confirm-majority aged past the window → "stale" + "Updated".
      {
        safetyState: "stale",
        hasRecentIncident: false,
        evidence: { confirmations: 30, contributors: 12 },
        freshness: { kind: "stale", label: "Updated 6mo ago" },
        suggestedByBot: false,
      },
      // contested: disputes lead → gluten-friendly; the fresh confirm still
      // reads as a "Verified" freshness cue (an independent display signal).
      {
        safetyState: "gluten-friendly",
        hasRecentIncident: false,
        evidence: { confirmations: 2, contributors: 7 },
        freshness: { kind: "fresh", label: "Verified 8d ago" },
        suggestedByBot: false,
      },
      // recent-incident: fresh confirm-majority (celiac-safe) BUT a recent report
      // flags the card and the incident cue wins the freshness slot.
      {
        safetyState: "celiac-safe",
        hasRecentIncident: true,
        evidence: { confirmations: 8, contributors: 5 },
        freshness: { kind: "incident", label: "Reported 10d ago" },
        suggestedByBot: false,
      },
      // unattested: no celiac claim → honest empty state, no evidence, no cue.
      {
        safetyState: null,
        hasRecentIncident: false,
        evidence: null,
        freshness: null,
        suggestedByBot: false,
      },
    ];

    expect(glances).toEqual(expected);
  });

  it("shows the honest empty evidence state for a zero-vote celiac claim", async () => {
    // A claim row that exists but has NO attestations (0 confirms / 0 disputes)
    // must surface `evidence: null` and `safetyState: null` — never a fabricated
    // "0 confirmations" verdict (a celiac could be hurt).
    const listing = mkListing({ id: "l-zero", name: "Zero Votes" });
    state.celiacRows = [
      {
        listingId: "l-zero",
        claimId: "c-zero",
        lastConfirmedAt: null,
        confirmCount: "0",
        disputeCount: "0",
        contributors: "0",
      },
    ];

    const cards = await buildBrowseCards([listing], NOW, 6);

    expect(cards[0]?.glance).toEqual({
      safetyState: null,
      hasRecentIncident: false,
      evidence: null,
      freshness: null,
      suggestedByBot: false,
    });
  });

  it("threads the staleness window so the SAME confirmation flips fresh↔stale", async () => {
    // The injected `stalenessMonths` is the ONLY thing that changes between the
    // two calls, proving the boundary is caller-controlled (matches the sort).
    const listing = mkListing({ id: "l-window", name: "Window Test" });
    state.celiacRows = [
      {
        listingId: "l-window",
        claimId: "c-window",
        lastConfirmedAt: new Date("2026-03-01T00:00:00Z"), // ~119d ago
        confirmCount: "5",
        disputeCount: "0",
        contributors: "3",
      },
    ];

    // A 6-month (180d) window → the ~119d-old confirm is FRESH → celiac-safe.
    const wide = await buildBrowseCards([listing], NOW, 6);
    expect(wide[0]?.glance.safetyState).toBe("celiac-safe");

    // A 3-month (90d) window → the SAME confirm is now STALE.
    const narrow = await buildBrowseCards([listing], NOW, 3);
    expect(narrow[0]?.glance.safetyState).toBe("stale");
  });
});
