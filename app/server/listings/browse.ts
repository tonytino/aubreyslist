import { and, asc, desc, eq, gt, inArray, isNotNull, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import {
  attestations,
  type ClaimAttribute,
  claimAttributes,
  claims,
  incidents,
  type Listing,
  listings,
} from "~/db/schema";
import { BROWSE_PAGE_SIZE, MAX_PAGE_SIZE } from "~/listings/browse-params";
import { type Coords, EARTH_RADIUS_KM, milesToKm, UNION_STATION } from "~/listings/distance";
import { QUICK_FILTER_VALUES, type QuickFilterValue } from "~/listings/quick";
import {
  BROWSE_SORT_VALUES,
  type BrowseSort,
  DEFAULT_BROWSE_SORT,
  DISTANCE_FALLBACK_SORT,
} from "~/listings/sort";
import type { ClaimAggregate } from "~/server/attestations";
import { getFavoriteCounts, getViewerFavoriteIds } from "~/server/favorites/index";
import { formatDistanceLabel } from "~/trust/browse-card-format";
import { deriveListingTrustGlance, type ListingTrustGlance } from "~/trust/browse-glance";
import { findRecentIncident, toCalendarDayString } from "~/trust/incident-recency";
import { DEFAULT_STALENESS_MONTHS, stalenessCutoff } from "~/trust/summary";
import { buildBrowseWhere } from "./filter";
import { buildQuickFilterPredicate } from "./quick-filter";
import { buildSearchPredicate } from "./search";

/**
 * Browse-list loader: every listing with its at-a-glance trust.
 *
 * The default browse view is list-first: a page of listing cards, each
 * showing the headline celiac-safe vs. gluten-friendly state and a
 * recent-incident flag at a glance. Reads are open/anonymous.
 *
 * No N+1: the page assembles from a small, fixed number of batched queries
 * regardless of page size —
 *   1. the page of listings (paginated),
 *   2. the `celiac_safe_vs_gluten_friendly` claim aggregate for that page,
 *      one grouped query scoped by `listingId IN (…)`,
 *   3. each page-listing's incidents, one `IN (…)` query reduced to a
 *      recent-incident boolean per listing via `findRecentIncident`, and
 *   4. which claim attributes still carry a live curator-bot suggestion, one
 *      `IN (…)` query.
 * The trust glance is then derived purely (`deriveListingTrustGlance`) from
 * those visible aggregates — a roll-up of visible evidence, never a score.
 *
 * Server-only: imports the DB client. The client-callable entry point lives
 * in `./browse.fn.ts` (the `*.fn.ts` convention), so the browse route's
 * client bundle never drags in `getDb`.
 */

/** Validated input for a page of the browse list. */
export const browseListingsInputSchema = z.object({
  /** 1-based page number. Defaults to the first page. */
  page: z.number().int().min(1).default(1),
  /** Page size; clamped to a sane maximum. Defaults to {@link BROWSE_PAGE_SIZE}. */
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(BROWSE_PAGE_SIZE),
  /**
   * Free-text search over name/address. Empty/whitespace means no constraint.
   * Composes with the GF taxonomy filter via `and(...)`, so the count and
   * page reflect search + filters together.
   */
  q: z.string().max(256).optional(),
  /**
   * Selected GF taxonomy attributes to filter by, validated against the fixed
   * `claim_attribute` enum so an unknown value can never reach the query. A
   * listing matches only when each selected attribute has positive community
   * consensus (confirms outnumber disputes) — see `./filter.ts`.
   * Empty/omitted means no taxonomy constraint.
   */
  attrs: z.array(z.enum(claimAttributes)).default([]),
  /**
   * Sort order. One of the {@link BrowseSort} tokens; an unknown token
   * degrades to {@link DEFAULT_BROWSE_SORT} ("near me") rather than
   * erroring. Combines with search + filters — sort only changes
   * `ORDER BY`, never the `WHERE`, so the filtered total and pagination stay
   * correct.
   */
  sort: z.enum(BROWSE_SORT_VALUES as [BrowseSort, ...BrowseSort[]]).catch(DEFAULT_BROWSE_SORT),
  /**
   * The visitor's location for the "near me" distance sort. Optional and
   * validated to WGS84 ranges; used only as a complete pair when
   * `sort=distance`. Rounded client-side before it is sent
   * (`coarsenCoords`), so the precise fix never reaches the server.
   *
   * Absent when the browser has not answered (or refused). The handler then
   * falls back to the request's coarse IP location, and with neither the
   * ORDER BY degrades to {@link DISTANCE_FALLBACK_SORT} rather than erroring.
   * Coords are ignored for any non-distance sort.
   */
  userLat: z.number().finite().min(-90).max(90).optional(),
  userLng: z.number().finite().min(-180).max(180).optional(),
  /**
   * Distance-radius filter: keep only listings within `radiusMiles` of the
   * origin (`originLat`/`originLng`). Optional. Independent of
   * `userLat`/`userLng` above — those drive the "near me" sort order; these
   * constrain the result set. Kept separate because the origin falls
   * back through the coarse request location to Denver Union Station, whereas
   * the near-me sort degrades to {@link DISTANCE_FALLBACK_SORT} instead of
   * anchoring on a landmark.
   *
   * The predicate applies whenever `radiusMiles` is set: an absent or
   * half-supplied origin falls back to whatever located the sort, then to
   * Union Station, so a "Within N mi" chip always filters by N miles of
   * somewhere rather than silently by nothing. The origin is validated to the
   * same WGS84 ranges as the coords schema so a garbage value can never reach
   * the SQL.
   */
  radiusMiles: z.number().finite().positive().optional(),
  originLat: z.number().finite().min(-90).max(90).optional(),
  originLng: z.number().finite().min(-180).max(180).optional(),
  /**
   * Server-side "Saved" filter. When set and the caller is signed in, the
   * browse is constrained to the viewer's visible favorite listing ids
   * ({@link getViewerFavoriteIds}) — folded into the WHERE before paginating,
   * so `page`/`total`/`hasMore` stay honest over the full favorites subset
   * (never a client-side filter over the loaded page). An anonymous caller or
   * an empty favorite set yields an empty page without a broad query.
   *
   * Privacy (spec §11.1): a `savedOnly` response is viewer-specific — it must
   * never be shared/edge/CDN-cached. See `./browse.fn.ts`.
   */
  savedOnly: z.boolean().default(false),
  /**
   * Prebuilt "quick" filters over the displayed safety glance — `celiac`
   * (celiac-safe), `friendly` (gluten-friendly), `recent` (freshly verified,
   * no recent incident). A faceted set: each selected token's correlated
   * predicate AND-composes into the same `where` as search/taxonomy/radius,
   * so page, total and pagination all reflect the conjunction (see
   * `./quick-filter.ts`). Empty means no quick constraint. Composes with
   * `attrs` (AND) and is orthogonal to `sort` (which only reorders). Mutual
   * exclusivity within the `safety` group is enforced upstream by
   * `parseQuick`.
   */
  quick: z
    .array(z.enum(QUICK_FILTER_VALUES as unknown as [QuickFilterValue, ...QuickFilterValue[]]))
    .default([]),
  /**
   * Whether curator-bot suggestions participate in the browse. Default true:
   * a live, unvoted suggestion also satisfies the taxonomy `attrs` filter and
   * the `quick=celiac` chip — a discovery aid surfacing candidates worth
   * validating. The browse card labels every listing with a live suggestion
   * on any visible claim "Suggested by Aubrey's Bot" and badges each
   * suggested attribute, so a suggestion-matched card always shows where its
   * labels came from. False (the `?bot=` param's "Hide bot suggestions" chip)
   * does two things: (1) reverts filter matching to community-evidence-only,
   * and (2) excludes bot-suggested-only listings — a live suggestion with no
   * community attestation evidence on any visible claim — from the result set
   * (`buildSuggestedOnlyExclusion` in `./filter.ts`, AND-folded into the
   * shared where so the page and the honest total both reflect it). A listing
   * with any real community evidence stays visible either way. Affects only
   * matching and which listings are returned — never the trust glance, its
   * counts, or the sort (ADR-007: a suggestion is provenance, not evidence).
   */
  includeSuggested: z.boolean().default(true),
});
export type BrowseListingsInput = z.infer<typeof browseListingsInputSchema>;

/**
 * The trust core of a browse card — the listing plus its precomputed trust
 * glance — before browse-only concerns (distance, save-count) are layered on.
 * Produced by the distance-agnostic {@link buildBrowseCards}; the browse-only
 * fields below are attached by {@link getBrowseListings}.
 */
export interface BrowseListingCardCore {
  listing: Listing;
  glance: ListingTrustGlance;
}

/** One browse card's data: the trust core plus browse-only display concerns. */
export interface BrowseListingCard extends BrowseListingCardCore {
  /**
   * A "0.4 mi" distance label, present only when the page is distance-sorted
   * with a complete user coordinate pair. Reused from the distance-sort
   * path's haversine (never recomputed client-side); omitted for other sorts.
   */
  distanceLabel?: string;
  /**
   * Public, user-agnostic count of how many people saved this listing — the
   * grouped `favorites` aggregate ({@link getFavoriteCounts}), `0` when the
   * listing has no favorites. A plain number on the client-safe card, never a
   * viewer-scoped or safety signal (ADR-007): the card renders it as the
   * save-count pill.
   */
  favoriteCount: number;
}

/** A page of browse cards plus the cursor info the UI needs to paginate. */
/**
 * Which anchor the distance sort actually used. The UI explains itself from
 * this rather than guessing from permission state, which cannot see the
 * request-header fallback at all.
 */
export type BrowseLocationSource = "precise" | "coarse" | "none";

export interface BrowseListingsPage {
  cards: BrowseListingCard[];
  page: number;
  pageSize: number;
  /** The sort requested for this page (echoed back so the UI can reflect state). */
  sort: BrowseSort;
  /**
   * The order actually applied. Equals `sort` except when "near me" ran with
   * no location at all, where it is {@link DISTANCE_FALLBACK_SORT} — so the
   * page never claims an order it did not use.
   */
  effectiveSort: BrowseSort;
  /** Which location anchored the distance sort, if any. */
  locationSource: BrowseLocationSource;
  /** Total listing count (after search/filters) for "showing X of Y" + paging. */
  total: number;
  /** Whether a further page exists after this one. */
  hasMore: boolean;
}

/**
 * Load one page of listings with their at-a-glance trust.
 *
 * `now` and `stalenessMonths` are injectable so the route can resolve "now"
 * once server-side (matching the listing-detail page) and thread the
 * admin-tunable staleness window through; both default sensibly for direct use.
 *
 * `coarseOrigin` is the request's approximate location (`request-geo.ts`),
 * passed by the server fn rather than taken from `input` because it is
 * derived from the request, not from anything the client may assert.
 */
export async function getBrowseListings(
  input: BrowseListingsInput,
  now: Date = new Date(),
  stalenessMonths?: number,
  coarseOrigin?: Coords
): Promise<BrowseListingsPage> {
  const db = getDb();
  const { page, pageSize, sort } = input;
  const offset = (page - 1) * pageSize;

  // The distance anchor, best available first: the browser's reading (already
  // rounded client-side), else the coarse location on the request. Both the
  // ORDER BY and the response's explanation derive from this one resolution,
  // so the page can never describe an anchor it did not use.
  const preciseCoords: Coords | undefined =
    input.userLat !== undefined && input.userLng !== undefined
      ? { lat: input.userLat, lng: input.userLng }
      : undefined;
  const coords = preciseCoords ?? coarseOrigin;
  const locationSource: BrowseLocationSource = preciseCoords
    ? "precise"
    : coords
      ? "coarse"
      : "none";
  const effectiveSort = resolveEffectiveSort(sort, coords);

  // Compose the WHERE from the text search and the GF taxonomy filter,
  // AND-combined. The same predicate constrains both the page query and the
  // count query, so the total reflects the active filters and pagination
  // stays correct. `undefined` (nothing selected) — drizzle applies no WHERE.
  //
  // Public read: non-visible listings are excluded, AND-folded with the
  // search/filter so page, total and pagination reflect only visible rows.
  const visibleListing = eq(listings.moderationStatus, "visible");
  const searchAndFilter = buildBrowseWhere(
    buildSearchPredicate(input.q ?? ""),
    input.attrs,
    input.includeSuggested
  );

  // Distance-radius filter. Applies only when the complete triple is present
  // — a radius plus both origin coordinates. AND-folded into the shared
  // `where` below, so the same predicate constrains both the page and count
  // queries: a "Within 5 mi" filter can never report a count that includes
  // out-of-range listings. Independent of `userLat`/`userLng` (those only
  // drive the sort ORDER BY).
  // The radius anchor falls back where the sort degrades: an explicit origin,
  // else whatever located the sort, else Union Station — so "Within N mi"
  // stays meaningful for a visitor the browser never located.
  const radiusOrigin =
    input.originLat !== undefined && input.originLng !== undefined
      ? { lat: input.originLat, lng: input.originLng }
      : (coords ?? UNION_STATION);
  const radiusPredicate = buildRadiusPredicate(
    input.radiusMiles,
    radiusOrigin.lat,
    radiusOrigin.lng
  );

  // Server-side "Saved" filter. When `savedOnly` is set, resolve the viewer's
  // visible favorite ids and constrain to `listings.id IN (…)` — folded into
  // the shared `where` below so it applies to both the page and count
  // queries, keeping `page`/`total`/`hasMore` honest over the full favorites
  // subset (not a client-side filter over the loaded page).
  // `getViewerFavoriteIds()` returns `[]` for an anonymous caller and for a
  // signed-in user with no visible favorites; either way, short-circuit to an
  // empty page without ever issuing a broad (unconstrained) query.
  let savedPredicate: SQL | undefined;
  if (input.savedOnly) {
    const favoriteIds = await getViewerFavoriteIds();
    if (favoriteIds.length === 0) {
      return {
        cards: [],
        page,
        pageSize,
        sort,
        effectiveSort,
        locationSource,
        total: 0,
        hasMore: false,
      };
    }
    savedPredicate = inArray(listings.id, favoriteIds);
  }

  // Resolve the staleness window once, up front: both the quick filter's
  // freshness predicate and the trust sort's ORDER BY use it, so the SQL
  // fresh/stale edge matches the displayed glance exactly (no drift).
  const resolvedStalenessMonths = stalenessMonths ?? DEFAULT_STALENESS_MONTHS;

  // Prebuilt quick filter: a correlated predicate over the displayed safety
  // glance (celiac-safe / gluten-friendly / freshly-verified). Undefined when
  // no chip is active. AND-folded into the shared `where` below, so it
  // constrains the page and count queries alike — the total reflects it.
  const quickPredicate = buildQuickFilterPredicate(
    input.quick,
    now,
    resolvedStalenessMonths,
    input.includeSuggested
  );

  // Compose visibility with the search/filter, radius, saved and quick
  // predicates. `and(...)` drops `undefined` terms, so an inactive constraint
  // contributes nothing.
  const where =
    searchAndFilter || radiusPredicate || savedPredicate || quickPredicate
      ? and(visibleListing, searchAndFilter, radiusPredicate, savedPredicate, quickPredicate)
      : visibleListing;

  // The ORDER BY. Search/filter live in the WHERE above; sort only touches
  // the ORDER BY, so the three compose cleanly. The trust sort joins a
  // per-listing celiac-trust subquery and ranks by the same displayed safety
  // tier (confirm/dispute counts + `lastConfirmedAt` staleness) — a roll-up
  // of visible evidence, not an opaque score (ADR-007).
  const trust = celiacTrustSubquery();
  const orderBy = buildOrderBy(effectiveSort, trust, now, resolvedStalenessMonths, coords);

  // Per-card distance labels need the browser's own reading: a city-level
  // request anchor can be kilometres off, and "0.4 mi" from it would be a
  // precise-looking number the data cannot support. A coarse anchor still
  // ORDERs the list (roughly right, and better than no distance sort at all)
  // but earns no label. Reuses the same haversine the ordering derives from,
  // so a shown label and the sort never disagree.
  const distanceKm =
    effectiveSort === "distance" && preciseCoords ? distanceKmExpr(preciseCoords) : null;

  // 1. The page of listings under the current search + filter + sort, plus
  //    the matching total (same `WHERE`) so the UI can render "X of Y" +
  //    has-more. The trust subquery is LEFT JOINed so the sort can order by
  //    its columns; rows are wrapped as `{ listing }` by the projection. When
  //    distance-sorting, the per-row distance (km) is selected alongside.
  const [pageListings, totalRows] = await Promise.all([
    db
      .select(distanceKm ? { listing: listings, distanceKm } : { listing: listings })
      .from(listings)
      .leftJoin(trust, eq(trust.listingId, listings.id))
      .where(where)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)` }).from(listings).where(where),
  ]);

  const total = Number(totalRows[0]?.total ?? 0);

  // No listings on this page: return early rather than running the batched
  // signal queries with an empty `IN ()`.
  if (pageListings.length === 0) {
    return {
      cards: [],
      page,
      pageSize,
      sort,
      effectiveSort,
      locationSource,
      total,
      hasMore: false,
    };
  }

  const pageRows = pageListings.map((row) => row.listing);

  // The per-row distance (km) by listing id, when distance-sorting. Some rows
  // (tests, or a non-distance sort) omit the column; a missing/NaN value
  // yields no label rather than a fabricated "0.0 mi".
  const distanceByListing = new Map<string, number>();
  for (const row of pageListings) {
    const km = (row as { distanceKm?: number | string | null }).distanceKm;
    if (km !== undefined && km !== null) {
      const n = Number(km);
      if (Number.isFinite(n)) {
        distanceByListing.set(row.listing.id, n);
      }
    }
  }

  // 2.+3. Derive each card's listing + at-a-glance trust. `buildBrowseCards`
  //    owns the trust-glance tail (celiac aggregate + recent incident +
  //    suggested attributes) and is distance-agnostic so a distance-less
  //    caller can reuse it. The public save-count aggregate is batched
  //    alongside (one grouped query for the whole page, no N+1) — a browse
  //    concern like distance, so it stays here rather than in the reusable
  //    helper.
  const pageListingIds = pageRows.map((listing) => listing.id);
  const [baseCards, favoriteCounts] = await Promise.all([
    buildBrowseCards(pageRows, now, resolvedStalenessMonths),
    getFavoriteCounts(pageListingIds),
  ]);

  // Attach the save-count and the "0.4 mi" distance label after the glance
  // derivation — both are browse-only concerns, never part of the reusable
  // trust glance. The count defaults to 0 for a listing absent from the
  // grouped aggregate. The distance label is spread in conditionally so the
  // optional prop is truly absent (not `undefined`) under
  // `exactOptionalPropertyTypes` — and only when distance-sorting produced a
  // value for this row.
  const cards: BrowseListingCard[] = baseCards.map((card) => {
    const favoriteCount = favoriteCounts.get(card.listing.id) ?? 0;
    const km = distanceByListing.get(card.listing.id);
    return km !== undefined
      ? { ...card, favoriteCount, distanceLabel: formatDistanceLabel(km) }
      : { ...card, favoriteCount };
  });

  return {
    cards,
    page,
    pageSize,
    sort,
    effectiveSort,
    locationSource,
    total,
    hasMore: offset + pageRows.length < total,
  };
}

/**
 * Build browse cards — each listing paired with its at-a-glance trust. Owns
 * only the trust-glance derivation (ADR-007): it batches the four visible
 * signals (the headline celiac aggregate, the recent-incident dates, the live
 * bot-suggested attribute set, and the confirmed non-headline attribute set)
 * and reduces each listing to a pure {@link ListingTrustGlance} via
 * {@link deriveListingTrustGlance}.
 *
 * Distance-agnostic by design: the "0.4 mi" `distanceLabel` is a browse-only
 * concern and stays in {@link getBrowseListings}, so a distance-less caller
 * can reuse this helper without change. Cards come back in the same order as
 * `listings`.
 *
 * No N+1: the four signal queries batch across all `listings` at once.
 *
 * Server-only: drives the db-backed aggregate helpers below, so it must never
 * be imported into client code (same rule as the rest of this module).
 *
 * `now` and `stalenessMonths` are injected so the glance's staleness boundary
 * matches the caller's already-resolved window exactly (no drift between the
 * sort and the displayed card).
 */
export async function buildBrowseCards(
  listings: Listing[],
  now: Date,
  stalenessMonths: number
): Promise<BrowseListingCardCore[]> {
  // Nothing to build: no cards, and skip the batched signal queries (which
  // would otherwise run an empty `IN ()`), mirroring the empty-page guard.
  if (listings.length === 0) {
    return [];
  }

  const listingIds = listings.map((listing) => listing.id);

  const [celiacAggregates, recentIncidentDates, botSuggestedAttributes, confirmedAttributes] =
    await Promise.all([
      getCeliacAggregatesByListing(listingIds),
      getRecentIncidentDatesByListing(listingIds, now),
      getBotSuggestedAttributesByListing(listingIds),
      getConfirmedAttributesByListing(listingIds),
    ]);

  return listings.map((listing) => {
    const celiac = celiacAggregates.get(listing.id) ?? null;
    const glance = deriveListingTrustGlance(
      celiac?.aggregate ?? null,
      celiac?.contributors ?? 0,
      recentIncidentDates.get(listing.id) ?? null,
      now,
      stalenessMonths,
      botSuggestedAttributes.get(listing.id) ?? [],
      confirmedAttributes.get(listing.id) ?? []
    );
    return { listing, glance };
  });
}

/**
 * Subquery: per listing, the headline celiac claim's visible evidence — the
 * raw confirm/dispute counts and the recency timestamp the at-a-glance trust
 * derives from. Raw counts (not just net) because the trust sort must
 * reproduce the displayed safety tier, which needs the contested check
 * (`confirms <= disputes`) and the staleness comparison — the same signals
 * `deriveHeadlineSafetyState` reads (ADR-007).
 *
 * - `confirmCount` / `disputeCount` — confirm and dispute tallies on the
 *   `celiac_safe_vs_gluten_friendly` claim.
 * - `lastConfirmedAt` — the claim's stored recency signal (null until first
 *   confirm; only confirms bump it).
 *
 * Listings with no such claim have no row here (the LEFT JOIN yields null, so
 * the ORDER BY treats them as the lowest tier and they sort last). A roll-up
 * of evidence the user can also see, never a score.
 */
function celiacTrustSubquery() {
  return (
    getDb()
      .select({
        listingId: claims.listingId,
        confirmCount: sql<number>`count(*) filter (where ${attestations.value} = 'confirm')`.as(
          "confirm_count"
        ),
        disputeCount: sql<number>`count(*) filter (where ${attestations.value} = 'dispute')`.as(
          "dispute_count"
        ),
        lastConfirmedAt: sql<Date | null>`${claims.lastConfirmedAt}`.as("last_confirmed_at"),
      })
      .from(claims)
      .leftJoin(attestations, eq(attestations.claimId, claims.id))
      // Only visible claims feed the trust sort, so a hidden/removed claim
      // cannot influence ordering (matches the displayed glance).
      .where(
        sql`${claims.attribute} = 'celiac_safe_vs_gluten_friendly' and ${claims.moderationStatus} = 'visible'`
      )
      .groupBy(claims.listingId, claims.lastConfirmedAt)
      .as("celiac_trust")
  );
}

type CeliacTrustSubquery = ReturnType<typeof celiacTrustSubquery>;

/**
 * The explicit ORDER BY for each sort. Defined here so the ordering rules are
 * single-sourced; the registry in `app/listings/sort.ts` is the only other
 * place to touch when adding a sort.
 *
 * Safety-critical: the "trust" order must reproduce the same safety tier the
 * card displays (ADR-007: the sort must be derivable from the visible
 * glance). A naive "net confirms desc" would rank a stale 30-confirm listing
 * — or a contested 20/18 one — above a fresh, uncontested 3/0 celiac-safe
 * listing, sending a celiac to a place the product down-ranks. So the trust
 * sort orders by tier first, mirroring `deriveHeadlineSafetyState` over the
 * same signals (`confirmCount`, `disputeCount`, staleness against
 * `lastConfirmedAt`):
 *
 *   tier 4  celiac-safe  — has evidence, confirms > disputes, fresh
 *   tier 3  stale        — has evidence, confirms > disputes, past the window
 *   tier 2  contested    — has evidence, confirms <= disputes
 *   tier 1  unattested   — no celiac claim / no attestation evidence
 *
 * Within a tier: net confirms (confirms − disputes) desc, then most recently
 * confirmed (`lastConfirmedAt DESC NULLS LAST`), then name. The staleness
 * cutoff is the caller's `now − stalenessMonths`, so the SQL boundary matches
 * the displayed glance exactly (no drift between sort and card).
 *
 * Recent incidents deliberately do not influence the trust sort in v1; the
 * card still shows the incident flag, so the warning remains visible.
 *
 * "Near me": the `distance` case orders by the great-circle (haversine)
 * distance from `coords` to each listing's stored lat/lng, ascending — the
 * same formula as the pure `haversineKm` helper, in SQL. With no coords
 * (geolocation denied/unavailable, or SSR) it falls back to the alphabetical
 * default rather than erroring.
 *
 * Every sort ends with `name ASC` as a stable tiebreaker, so the order is
 * deterministic (no row shuffling between requests).
 */
/**
 * The order actually applied: "near me" with no anchor at all degrades to
 * {@link DISTANCE_FALLBACK_SORT}. One rule, read by both the ORDER BY and the
 * response, so the results and the UI's explanation cannot disagree.
 */
function resolveEffectiveSort(sort: BrowseSort, coords: Coords | undefined): BrowseSort {
  return sort === "distance" && !coords ? DISTANCE_FALLBACK_SORT : sort;
}

function buildOrderBy(
  sort: BrowseSort,
  trust: CeliacTrustSubquery,
  now: Date,
  stalenessMonths: number,
  coords?: Coords
): SQL[] {
  const nameTiebreak = asc(listings.name);

  // The staleness cutoff instant, from the same shared `stalenessCutoff`
  // helper the glance's `isStale` uses, so the SQL boundary equals the
  // displayed one exactly. Bound as a parameter below.
  const cutoff = stalenessCutoff(now, stalenessMonths);

  const hasEvidence = sql`coalesce(${trust.confirmCount}, 0) + coalesce(${trust.disputeCount}, 0) > 0`;
  const confirmsLead = sql`coalesce(${trust.confirmCount}, 0) > coalesce(${trust.disputeCount}, 0)`;
  // "Fresh" mirrors `isStale` exactly:
  //  - Inclusive lower bound (`>=`): a confirmation exactly on the staleness
  //    edge is fresh, matching `isStale`'s `age > window` rule (stale only
  //    once age strictly exceeds the window). A bare `>` would flip the
  //    exact-edge instant to stale in SQL while the card showed it fresh.
  //  - Null lastConfirmedAt is fresh, not stale: a confirm-majority claim
  //    never confirmed is "not yet confirmed", which `isStale(null)` treats
  //    as not-stale — celiac-safe (tier 4). Bare `lastConfirmedAt >= cutoff`
  //    is null (false) for a null timestamp, which would wrongly demote it to
  //    tier 3; the explicit `IS NULL` keeps SQL and JS on the same tier.
  const fresh = sql`(${trust.lastConfirmedAt} is null or ${trust.lastConfirmedAt} >= ${cutoff})`;

  // Safety tier mirroring `deriveHeadlineSafetyState` — higher sorts first.
  const safetyTier = sql<number>`case
    when ${hasEvidence} and ${confirmsLead} and ${fresh} then 4
    when ${hasEvidence} and ${confirmsLead} then 3
    when ${hasEvidence} then 2
    else 1
  end`;

  const netConfirms = sql`coalesce(${trust.confirmCount}, 0) - coalesce(${trust.disputeCount}, 0)`;
  const recency = sql`${trust.lastConfirmedAt}`;

  switch (sort) {
    case "trust":
      // Displayed safety tier first, then net consensus, recency, name.
      return [desc(safetyTier), desc(netConfirms), sql`${recency} desc nulls last`, nameTiebreak];
    case "recency":
      // Most recently confirmed first, then strongest consensus, then name.
      // Independent of tier by design: "recency" answers "what was just
      // re-verified", a different question than "what is safest".
      return [sql`${recency} desc nulls last`, desc(netConfirms), nameTiebreak];
    case "distance": {
      // No anchor at all: neither a browser reading nor a coarse request
      // location. Distance is uncomputable, so degrade to the fallback sort
      // rather than erroring — and to the SAME order the UI names in its
      // explanation, which reads `DISTANCE_FALLBACK_SORT` from the registry.
      if (!coords) {
        return buildOrderBy(DISTANCE_FALLBACK_SORT, trust, now, stalenessMonths);
      }
      // Closest first: great-circle distance from the user's coords to each
      // listing's stored lat/lng — the same haversine the pure `haversineKm`
      // helper computes, expressed in SQL so the DB does the ranking. The
      // constant `2 * R` multiplier and the final `asin`/`sqrt` are omitted:
      // both are monotonic in the haversine term `h`, so ordering by `h`
      // ascending yields the identical order while keeping the SQL cheap.
      const distanceTerm = sql`
        sin(radians(${listings.lat} - ${coords.lat}) / 2) ^ 2
        + cos(radians(${coords.lat})) * cos(radians(${listings.lat}))
        * sin(radians(${listings.lng} - ${coords.lng}) / 2) ^ 2`;
      return [asc(distanceTerm), nameTiebreak];
    }
    default:
      // Alphabetical — the stable, scannable default.
      return [nameTiebreak];
  }
}

/**
 * The great-circle distance in kilometres from `coords` to each listing's
 * stored lat/lng, as a SQL expression — the full haversine
 * (`2 * R * asin(sqrt(h))`), not the ordering-only `h` term `buildOrderBy`
 * uses: rendering a "0.4 mi" label needs the actual value, not just a
 * monotonic rank. The exact SQL analogue of the pure `haversineKm` helper
 * (same `EARTH_RADIUS_KM`), so the displayed distance and the ordering share
 * one definition.
 *
 * Selected into the page query only when distance-sorting with a complete
 * coord pair, so a non-distance sort pays nothing for it.
 */
function distanceKmExpr(coords: Coords): SQL<number> {
  const h = sql`
    sin(radians(${listings.lat} - ${coords.lat}) / 2) ^ 2
    + cos(radians(${coords.lat})) * cos(radians(${listings.lat}))
    * sin(radians(${listings.lng} - ${coords.lng}) / 2) ^ 2`;
  return sql<number>`2 * ${EARTH_RADIUS_KM} * asin(least(1, sqrt(${h})))`;
}

/**
 * The distance-radius filter predicate: "listing is within `radiusMiles` of
 * the origin", or `undefined` when the filter is inactive.
 *
 * Inactive (no constraint) unless the complete triple is present — a radius
 * plus both origin coordinates — so a half-origin or missing radius leaves
 * the result set unchanged. When active, it compares the same great-circle km
 * expression the near-me sort/label derive from ({@link distanceKmExpr}) to
 * the radius converted to kilometres ({@link milesToKm}). Inclusive (`<=`),
 * so a listing exactly on the radius boundary is kept.
 *
 * A plain `SQL` the caller AND-folds into the shared `where` — applying it to
 * the page and count queries alike keeps `total` honest.
 */
function buildRadiusPredicate(
  radiusMiles: number | undefined,
  originLat: number | undefined,
  originLng: number | undefined
): SQL | undefined {
  if (radiusMiles === undefined || originLat === undefined || originLng === undefined) {
    return undefined;
  }
  const origin: Coords = { lat: originLat, lng: originLng };
  return sql`${distanceKmExpr(origin)} <= ${milesToKm(radiusMiles)}`;
}

/** A listing's celiac aggregate plus its distinct-contributor count. */
interface CeliacAggregateWithContributors {
  aggregate: ClaimAggregate;
  /** Distinct people who attested (confirm OR dispute) the celiac claim. */
  contributors: number;
}

/**
 * Batch-load the `celiac_safe_vs_gluten_friendly` claim aggregate
 * (confirm/dispute counts + recency) and the distinct-contributor count for
 * each of `listingIds`, in one grouped query — one query for all cards, not
 * one per card (no N+1).
 *
 * Contributors is computed in the same grouped query as a
 * `count(distinct user_id)` over the left-joined `attestations`: the unique
 * `(claim_id, user_id)` constraint means one row per person per claim, so the
 * distinct count is exactly "how many different people weighed in". The LEFT
 * JOIN yields a single null `user_id` row for a claim with no attestations,
 * which `count(distinct …)` correctly counts as 0.
 *
 * Returns a map keyed by `listingId`; a listing with no celiac claim is
 * absent (the caller treats that as "no evidence" — "Not yet attested").
 */
async function getCeliacAggregatesByListing(
  listingIds: string[]
): Promise<Map<string, CeliacAggregateWithContributors>> {
  const rows = await getDb()
    .select({
      listingId: claims.listingId,
      claimId: claims.id,
      lastConfirmedAt: claims.lastConfirmedAt,
      // Curator-bot suggestion provenance for the headline celiac claim, so a
      // seeded-but-unvoted listing can show "Suggested by Aubrey's Bot"
      // instead of a bare "Not yet attested". Not a vote — never counted.
      suggestedBy: claims.suggestedBy,
      confirmCount: sql<number>`count(*) filter (where ${attestations.value} = 'confirm')`,
      disputeCount: sql<number>`count(*) filter (where ${attestations.value} = 'dispute')`,
      // Distinct people who attested this claim either way — the "N
      // neighbors" evidence count. Computed in this grouped query, so it
      // stays batched (no N+1). Null user_id (no attestations) counts as 0.
      contributors: sql<number>`count(distinct ${attestations.userId})`,
    })
    .from(claims)
    .leftJoin(attestations, eq(attestations.claimId, claims.id))
    // Only visible claims contribute to a card's headline celiac aggregate,
    // so a hidden/removed claim drops out and the confirm/dispute counts
    // recompute from the survivors.
    .where(
      sql`${claims.listingId} in ${listingIds} and ${claims.attribute} = 'celiac_safe_vs_gluten_friendly' and ${claims.moderationStatus} = 'visible'`
    )
    .groupBy(claims.listingId, claims.id, claims.lastConfirmedAt, claims.suggestedBy);

  const byListing = new Map<string, CeliacAggregateWithContributors>();
  for (const row of rows) {
    byListing.set(row.listingId, {
      aggregate: {
        claimId: row.claimId,
        lastConfirmedAt: row.lastConfirmedAt,
        confirmCount: Number(row.confirmCount),
        disputeCount: Number(row.disputeCount),
        suggested: Boolean(row.suggestedBy),
      },
      contributors: Number(row.contributors),
    });
  }
  return byListing;
}

/**
 * Batch-load which claim attributes of each of `listingIds` still carry a
 * live curator-bot suggestion: a visible claim — on any taxonomy attribute,
 * not just the headline celiac one — whose `suggested_by` is set. One
 * `IN (…)` query for the whole page (no N+1). Only visible claims count, so a
 * hidden/removed suggested claim stops driving the badge; the parent
 * listing's own visibility is already enforced by the page query that
 * produced `listingIds`.
 *
 * The first real vote on a claim clears its `suggested_by` server-side
 * (`castVote`), so that attribute drops out of the set — and its card badge —
 * the moment real evidence arrives. That clear is not atomic with the
 * attestation upsert (a documented crash window in `castVote` can transiently
 * leave both a vote and a stale `suggested_by`), so the query also gates on
 * "no attestation rows on this claim" (`NOT EXISTS`), mirroring the
 * zero-evidence guard in `summarizeClaim` and `buildLiveSuggestionHaving`: a
 * voted claim can never badge the card as suggested, even mid-window. A
 * listing with no remaining live suggestions is absent from the map, which
 * also clears the card's "Suggested by Aubrey's Bot" label.
 *
 * Returns a map from listing id to its live-suggested attributes (unordered;
 * the pure glance derivation dedupes and normalizes to taxonomy order).
 */
async function getBotSuggestedAttributesByListing(
  listingIds: string[]
): Promise<Map<string, ClaimAttribute[]>> {
  const rows = await getDb()
    .select({ suggestedListingId: claims.listingId, suggestedAttribute: claims.attribute })
    .from(claims)
    .where(
      and(
        inArray(claims.listingId, listingIds),
        isNotNull(claims.suggestedBy),
        eq(claims.moderationStatus, "visible"),
        // Vote gate (belt-and-braces): a suggestion is live only while the
        // claim has zero attestations — the same "suggested and no votes"
        // rule buildLiveSuggestionHaving encodes for filter matching. A raw
        // correlated NOT EXISTS (rather than a nested query builder) keeps
        // this a single expression on the one batched query.
        sql`not exists (select 1 from ${attestations} where ${attestations.claimId} = ${claims.id})`
      )
    );

  const byListing = new Map<string, ClaimAttribute[]>();
  for (const row of rows) {
    const attributes = byListing.get(row.suggestedListingId);
    if (attributes) {
      attributes.push(row.suggestedAttribute);
    } else {
      byListing.set(row.suggestedListingId, [row.suggestedAttribute]);
    }
  }
  return byListing;
}

/**
 * Batch-load which non-headline claim attributes of each of `listingIds` have
 * confirmed positive community consensus: a visible claim — on any taxonomy
 * attribute except the headline `celiac_safe_vs_gluten_friendly` (which
 * drives the SafetySignal verdict, not a claim badge) — whose attestations
 * have strictly more confirms than disputes. One grouped `IN (…)` query for
 * the whole page (no N+1), with the same visibility bound as the sibling
 * batched queries.
 *
 * The browse-card analogue of the listing-detail page's `confirmed` badge
 * branch (`hasPositiveConsensus`). The consensus rule is the same SQL shape
 * as `buildAttributeConsensusExists` in `./filter.ts` — the shared
 * `gt(confirmCount, disputeCount)` strict-greater fragment — so a tie or
 * dispute-majority claim never qualifies (contested ≠ affirmed; an overstated
 * badge could hurt a celiac).
 *
 * Recency/staleness is deliberately not part of the match, mirroring
 * `hasPositiveConsensus` and the taxonomy filter: a stale-but-uncontested
 * consensus is still real visible evidence and should badge (the glance flags
 * staleness separately). A live bot suggestion is not included — it is
 * provenance, not confirmed evidence, and stays on the separate suggested
 * path.
 *
 * Returns a map from listing id to its confirmed non-headline attributes
 * (unordered; the pure glance derivation dedupes, normalizes to taxonomy
 * order, and drops any attribute already carried on the suggested path).
 */
async function getConfirmedAttributesByListing(
  listingIds: string[]
): Promise<Map<string, ClaimAttribute[]>> {
  // The same conditional tallies the celiac aggregate and the taxonomy
  // filter use, so "positive consensus" means one thing everywhere.
  const confirmCount = sql<number>`count(*) filter (where ${attestations.value} = 'confirm')`;
  const disputeCount = sql<number>`count(*) filter (where ${attestations.value} = 'dispute')`;

  const rows = await getDb()
    .select({ confirmedListingId: claims.listingId, confirmedAttribute: claims.attribute })
    .from(claims)
    .leftJoin(attestations, eq(attestations.claimId, claims.id))
    .where(
      and(
        inArray(claims.listingId, listingIds),
        // Non-headline only: the celiac headline is the SafetySignal verdict.
        sql`${claims.attribute} <> 'celiac_safe_vs_gluten_friendly'`,
        // Only visible claims count toward consensus.
        eq(claims.moderationStatus, "visible")
      )
    )
    .groupBy(claims.id, claims.listingId, claims.attribute)
    // Positive consensus: confirms strictly outnumber disputes — the exact
    // `gt(...)` fragment `buildAttributeConsensusExists` uses (parity with
    // `hasPositiveConsensus`; a tie never qualifies).
    .having(gt(confirmCount, disputeCount));

  const byListing = new Map<string, ClaimAttribute[]>();
  for (const row of rows) {
    const attributes = byListing.get(row.confirmedListingId);
    if (attributes) {
      attributes.push(row.confirmedAttribute);
    } else {
      byListing.set(row.confirmedListingId, [row.confirmedAttribute]);
    }
  }
  return byListing;
}

/**
 * Batch-load incidents for `listingIds` in one query and reduce to a map from
 * listing id to the most recent in-window incident's instant, or absent when
 * the listing has no recent incident. Uses the same pure `findRecentIncident`
 * helper as the listing-detail banner, so "recent" means exactly the same
 * thing on the card as on the detail page.
 *
 * The returned `Date` is the incident day at UTC midnight (incidents are
 * stored as calendar dates, no time-of-day), so the card's freshness cue can
 * phrase "Reported Nd ago" without fabricating a time.
 */
async function getRecentIncidentDatesByListing(
  listingIds: string[],
  now: Date
): Promise<Map<string, Date>> {
  const rows = await getDb()
    .select({ listingId: incidents.listingId, occurredOn: incidents.occurredOn })
    .from(incidents)
    // Only visible incidents count toward the card's recent-incident signal.
    // The trust-model guarantee in reverse: moderation can drop a
    // moderated-away incident, but a real, still-visible recent incident is
    // never buried.
    .where(
      and(inArray(incidents.listingId, listingIds), eq(incidents.moderationStatus, "visible"))
    );

  // Group incidents per listing, then ask `findRecentIncident` per group so
  // the window definition stays single-sourced.
  const byListing = new Map<string, { occurredOn: string }[]>();
  for (const row of rows) {
    // Normalize the driver's `date` value to the canonical YYYY-MM-DD string
    // the recency helpers contract on (Neon HTTP returns a `date` as a Date —
    // see toCalendarDayString), so the card's recent-incident flag and the
    // most-recent tiebreak are correct.
    const occurredOn = toCalendarDayString(row.occurredOn);
    const list = byListing.get(row.listingId);
    if (list) {
      list.push({ occurredOn });
    } else {
      byListing.set(row.listingId, [{ occurredOn }]);
    }
  }

  const recent = new Map<string, Date>();
  for (const [listingId, incidentList] of byListing) {
    const mostRecent = findRecentIncident(incidentList, now);
    if (mostRecent !== null) {
      // The recent incident's calendar day at UTC midnight — the honest instant
      // the freshness cue phrases "Reported Nd ago" from.
      recent.set(listingId, new Date(`${mostRecent.occurredOn}T00:00:00Z`));
    }
  }
  return recent;
}
