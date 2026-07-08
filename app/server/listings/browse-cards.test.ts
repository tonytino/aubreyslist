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
 * exactly four batched queries (celiac aggregate + incidents + the AUB-193
 * bot-suggested-attribute set + the AUB-226 confirmed non-headline attribute
 * set); the mock routes each by its `select()` projection and returns the
 * fixtures verbatim, so the IN(...) filter is irrelevant to what a row maps to
 * (the row's own `listingId` keys it).
 *
 * The helper is DISTANCE-AGNOSTIC (the "0.4 mi" label lives in
 * `getBrowseListings`), so no distance is asserted here — that path stays pinned
 * in `browse.test.ts`.
 */

const h = vi.hoisted(() => {
  const state = {
    celiacRows: [] as Array<Record<string, unknown>>,
    incidentRows: [] as Array<Record<string, unknown>>,
    suggestionRows: [] as Array<Record<string, unknown>>,
    confirmedRows: [] as Array<Record<string, unknown>>,
  };

  // The celiac-aggregate chain: select(proj).from().leftJoin().where().groupBy()
  const aggGroupByMock = vi.fn(() => Promise.resolve(state.celiacRows));
  const aggWhereMock = vi.fn(() => ({ groupBy: aggGroupByMock }));
  const aggLeftJoinMock = vi.fn(() => ({ where: aggWhereMock }));
  const aggFromMock = vi.fn(() => ({ leftJoin: aggLeftJoinMock }));

  // The incidents chain: select(proj).from().where()  (awaited)
  const incidentWhereMock = vi.fn(() => Promise.resolve(state.incidentRows));
  const incidentFromMock = vi.fn(() => ({ where: incidentWhereMock }));

  // The bot-suggestion existence chain (AUB-193): select(proj).from().where()
  const suggestionWhereMock = vi.fn(() => Promise.resolve(state.suggestionRows));
  const suggestionFromMock = vi.fn(() => ({ where: suggestionWhereMock }));

  // The confirmed-attribute consensus chain (AUB-226):
  //   select(proj).from().leftJoin().where().groupBy().having()
  // The `.where()` and `.having()` SQL args are captured (the mocks record their
  // calls) so a test can render them with PgDialect and assert the real SQL rule
  // (headline excluded; strict confirms > disputes) — the mock returns rows
  // verbatim, so the SQL itself is where those guarantees live.
  const confirmedHavingMock = vi.fn((_having?: unknown) => Promise.resolve(state.confirmedRows));
  const confirmedGroupByMock = vi.fn(() => ({ having: confirmedHavingMock }));
  const confirmedWhereMock = vi.fn((_predicate?: unknown) => ({ groupBy: confirmedGroupByMock }));
  const confirmedLeftJoinMock = vi.fn(() => ({ where: confirmedWhereMock }));
  const confirmedFromMock = vi.fn(() => ({ leftJoin: confirmedLeftJoinMock }));

  // Route each query to the right chain by its select() projection:
  //  - has `occurredOn`           → incidents
  //  - has `suggestedListingId`   → bot-suggestion existence (AUB-193)
  //  - has `confirmedListingId`   → confirmed-attribute consensus (AUB-226)
  //  - otherwise (claim cols)     → celiac aggregate
  const selectMock = vi.fn((projection?: Record<string, unknown>) => {
    if (projection && "occurredOn" in projection) return { from: incidentFromMock };
    if (projection && "suggestedListingId" in projection) return { from: suggestionFromMock };
    if (projection && "confirmedListingId" in projection) return { from: confirmedFromMock };
    return { from: aggFromMock };
  });

  return { state, selectMock, confirmedWhereMock, confirmedHavingMock };
});

vi.mock("~/db/client", () => ({
  getDb: () => ({ select: h.selectMock }),
}));

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
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
  state.suggestionRows = [];
  state.confirmedRows = [];
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
        suggestedAttributes: [],
        confirmedAttributes: [],
      },
      // stale: confirm-majority aged past the window → "stale" + "Updated".
      {
        safetyState: "stale",
        hasRecentIncident: false,
        evidence: { confirmations: 30, contributors: 12 },
        freshness: { kind: "stale", label: "Updated 6mo ago" },
        suggestedByBot: false,
        suggestedAttributes: [],
        confirmedAttributes: [],
      },
      // contested: disputes lead → gluten-friendly; the fresh confirm still
      // reads as a "Verified" freshness cue (an independent display signal).
      {
        safetyState: "gluten-friendly",
        hasRecentIncident: false,
        evidence: { confirmations: 2, contributors: 7 },
        freshness: { kind: "fresh", label: "Verified 8d ago" },
        suggestedByBot: false,
        suggestedAttributes: [],
        confirmedAttributes: [],
      },
      // recent-incident: fresh confirm-majority (celiac-safe) BUT a recent report
      // flags the card and the incident cue wins the freshness slot.
      {
        safetyState: "celiac-safe",
        hasRecentIncident: true,
        evidence: { confirmations: 8, contributors: 5 },
        freshness: { kind: "incident", label: "Reported 10d ago" },
        suggestedByBot: false,
        suggestedAttributes: [],
        confirmedAttributes: [],
      },
      // unattested: no celiac claim → honest empty state, no evidence, no cue.
      {
        safetyState: null,
        hasRecentIncident: false,
        evidence: null,
        freshness: null,
        suggestedByBot: false,
        suggestedAttributes: [],
        confirmedAttributes: [],
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
      suggestedAttributes: [],
      confirmedAttributes: [],
    });
  });

  it("flags suggestedByBot for a listing whose ONLY suggestion is a non-celiac claim (AUB-193)", async () => {
    // The shipped regression: 25 of the 46 seeded listings suggest only
    // non-celiac attributes (e.g. dedicated_fryer), so they have NO celiac
    // aggregate row — but the batched suggested-attribute query still finds
    // their live bot suggestion, so the card shows its provenance instead of a
    // bare "Not yet attested".
    const listing = mkListing({ id: "l-seeded", name: "Seeded Non-Celiac" });
    state.celiacRows = []; // no celiac claim at all
    state.suggestionRows = [
      { suggestedListingId: "l-seeded", suggestedAttribute: "dedicated_fryer" },
    ];

    const cards = await buildBrowseCards([listing], NOW, 6);

    expect(cards[0]?.glance).toEqual({
      safetyState: null,
      hasRecentIncident: false,
      evidence: null,
      freshness: null,
      suggestedByBot: true,
      suggestedAttributes: ["dedicated_fryer"],
      confirmedAttributes: [],
    });
  });

  it("KEEPS suggestedByBot true when live suggestions coexist with real celiac evidence (owner nit 7)", async () => {
    // A bot-suggested (non-celiac) claim plus a real celiac verdict: the label
    // is PROVENANCE and stays visible — but the verdict/evidence still derive
    // from evidence only (ADR-007: the suggestion never alters them).
    const listing = mkListing({ id: "l-mixed", name: "Mixed Evidence" });
    state.celiacRows = [
      {
        listingId: "l-mixed",
        claimId: "c-mixed",
        lastConfirmedAt: new Date("2026-06-20T00:00:00Z"),
        confirmCount: "4",
        disputeCount: "0",
        contributors: "4",
      },
    ];
    state.suggestionRows = [
      { suggestedListingId: "l-mixed", suggestedAttribute: "gf_substitutes" },
    ];

    const cards = await buildBrowseCards([listing], NOW, 6);

    expect(cards[0]?.glance.safetyState).toBe("celiac-safe");
    expect(cards[0]?.glance.evidence).toEqual({ confirmations: 4, contributors: 4 });
    expect(cards[0]?.glance.suggestedByBot).toBe(true);
    expect(cards[0]?.glance.suggestedAttributes).toEqual(["gf_substitutes"]);
  });

  it("normalizes a listing's suggested attributes to taxonomy order (deduped)", async () => {
    const listing = mkListing({ id: "l-multi", name: "Multi Suggested" });
    state.celiacRows = [];
    state.suggestionRows = [
      { suggestedListingId: "l-multi", suggestedAttribute: "gf_substitutes" },
      { suggestedListingId: "l-multi", suggestedAttribute: "celiac_safe_vs_gluten_friendly" },
      { suggestedListingId: "l-multi", suggestedAttribute: "dedicated_fryer" },
    ];

    const cards = await buildBrowseCards([listing], NOW, 6);

    expect(cards[0]?.glance.suggestedAttributes).toEqual([
      "celiac_safe_vs_gluten_friendly",
      "dedicated_fryer",
      "gf_substitutes",
    ]);
  });

  it("keeps suggestedByBot false when no live suggestion survives (cleared by a real vote)", async () => {
    // `castVote` nulls `suggested_by` server-side, so the existence query
    // returns no row for this listing — the chip honestly disappears.
    const listing = mkListing({ id: "l-cleared", name: "Cleared Suggestion" });
    state.celiacRows = [];
    state.suggestionRows = []; // suggestion cleared server-side

    const cards = await buildBrowseCards([listing], NOW, 6);

    expect(cards[0]?.glance.suggestedByBot).toBe(false);
    expect(cards[0]?.glance.safetyState).toBeNull();
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

describe("buildBrowseCards — CONFIRMED non-headline claim badges (AUB-226)", () => {
  it("surfaces a CONFIRMED non-headline attribute on the glance (detail-page parity)", async () => {
    // The regression this fixes: a confirmed non-headline claim (e.g. "Off-menu
    // GF on request") showed on the detail page but never on the browse card.
    const listing = mkListing({ id: "l-confirmed", name: "Confirmed Claims" });
    state.celiacRows = [];
    state.confirmedRows = [
      { confirmedListingId: "l-confirmed", confirmedAttribute: "off_menu_gf_on_request" },
    ];

    const cards = await buildBrowseCards([listing], NOW, 6);

    expect(cards[0]?.glance.confirmedAttributes).toEqual(["off_menu_gf_on_request"]);
    // Confirmed is EVIDENCE, not a bot suggestion — the provenance flag stays off.
    expect(cards[0]?.glance.suggestedByBot).toBe(false);
    expect(cards[0]?.glance.suggestedAttributes).toEqual([]);
  });

  it("normalizes multiple confirmed attributes to taxonomy order (deduped)", async () => {
    const listing = mkListing({ id: "l-multi", name: "Multi Confirmed" });
    state.confirmedRows = [
      { confirmedListingId: "l-multi", confirmedAttribute: "gf_substitutes" },
      { confirmedListingId: "l-multi", confirmedAttribute: "dedicated_fryer" },
      { confirmedListingId: "l-multi", confirmedAttribute: "gf_substitutes" },
    ];

    const cards = await buildBrowseCards([listing], NOW, 6);

    expect(cards[0]?.glance.confirmedAttributes).toEqual(["dedicated_fryer", "gf_substitutes"]);
  });

  it("dedupes a confirmed attribute AGAINST the suggested set (never both at once)", async () => {
    // Confirmed evidence and a live suggestion are mutually exclusive by
    // construction; the glance drops any confirmed attribute also on the
    // suggested path so the card never double-badges one attribute.
    const listing = mkListing({ id: "l-overlap", name: "Overlap" });
    state.suggestionRows = [
      { suggestedListingId: "l-overlap", suggestedAttribute: "dedicated_fryer" },
    ];
    state.confirmedRows = [
      { confirmedListingId: "l-overlap", confirmedAttribute: "dedicated_fryer" },
      { confirmedListingId: "l-overlap", confirmedAttribute: "gf_substitutes" },
    ];

    const cards = await buildBrowseCards([listing], NOW, 6);

    // dedicated_fryer stays on the suggested (provenance) path only.
    expect(cards[0]?.glance.suggestedAttributes).toEqual(["dedicated_fryer"]);
    expect(cards[0]?.glance.confirmedAttributes).toEqual(["gf_substitutes"]);
  });

  it("excludes the headline claim and requires STRICT confirms>disputes in the query SQL", async () => {
    // The mock returns rows verbatim, so the "headline excluded" and "a tie/
    // dispute-majority does NOT surface" guarantees live in the SQL itself.
    // Render the captured WHERE + HAVING and assert the rule directly.
    const listing = mkListing({ id: "l-sql", name: "SQL Shape" });

    await buildBrowseCards([listing], NOW, 6);

    const dialect = new PgDialect();
    const whereSql = dialect
      .sqlToQuery(h.confirmedWhereMock.mock.calls[0]?.[0] as SQL)
      .sql.toLowerCase();
    const havingSql = dialect
      .sqlToQuery(h.confirmedHavingMock.mock.calls[0]?.[0] as SQL)
      .sql.toLowerCase();

    // Headline excluded: the WHERE filters the celiac attribute OUT (`<>`).
    expect(whereSql).toContain("<>");
    expect(whereSql).toContain("celiac_safe_vs_gluten_friendly");
    // Visibility (#41): only `visible` claims count toward consensus.
    expect(whereSql).toContain("moderation_status");
    // STRICT positive consensus: confirms `>` disputes, never `>=` — a tie or
    // dispute-majority (contested) must NOT surface as a confirmed badge.
    expect(havingSql).toContain("'confirm'");
    expect(havingSql).toContain("'dispute'");
    expect(havingSql).toContain(" > ");
    expect(havingSql).not.toContain(">=");
    // Confirms on the LEFT of `>`, disputes on the RIGHT (not the inverse).
    const gtIndex = havingSql.indexOf(" > ");
    expect(havingSql.indexOf("'confirm'")).toBeLessThan(gtIndex);
    expect(havingSql.lastIndexOf("'dispute'")).toBeGreaterThan(gtIndex);
  });
});
