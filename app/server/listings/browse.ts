import { type SQL, and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import {
  type Listing,
  attestations,
  claimAttributes,
  claims,
  incidents,
  listings,
} from "~/db/schema";
import { BROWSE_PAGE_SIZE, MAX_PAGE_SIZE } from "~/listings/browse-params";
import { type Coords, EARTH_RADIUS_KM } from "~/listings/distance";
import { BROWSE_SORT_VALUES, type BrowseSort, DEFAULT_BROWSE_SORT } from "~/listings/sort";
import type { ClaimAggregate } from "~/server/attestations";
import { formatDistanceLabel } from "~/trust/browse-card-format";
import { type ListingTrustGlance, deriveListingTrustGlance } from "~/trust/browse-glance";
import { findRecentIncident, toCalendarDayString } from "~/trust/incident-recency";
import { DEFAULT_STALENESS_MONTHS, stalenessCutoff } from "~/trust/summary";
import { buildBrowseWhere } from "./filter";
import { buildSearchPredicate } from "./search";

/**
 * Browse-list loader: every listing WITH its at-a-glance trust (issue #33).
 *
 * The default Denver browse view (domain.md → Discovery) is list-first: a page
 * of listing cards, each showing the headline celiac-safe vs. gluten-friendly
 * state and a recent-incident flag at a glance. Reads are open/anonymous.
 *
 * NO N+1: the page is assembled from a small, FIXED number of batched queries
 * regardless of how many listings are on the page —
 *   1. the page of listings (paginated, alphabetical),
 *   2. the `celiac_safe_vs_gluten_friendly` claim aggregate for THAT page's
 *      listings, batched with one grouped query (mirrors
 *      `getListingClaimAggregates`'s conditional-count pattern, scoped by
 *      `listingId IN (…)`), and
 *   3. each page-listing's incidents, batched with one `IN (…)` query, reduced
 *      to a recent-incident boolean per listing via #30's `findRecentIncident`.
 * The trust glance is then derived purely (`deriveListingTrustGlance`) from
 * those visible aggregates — a roll-up of visible evidence, never a score.
 *
 * Server-only: imports the DB client. The client-callable `createServerFn`
 * entry point lives in `./browse.fn.ts` (the `*.fn.ts` convention) so the
 * browse route's client bundle never drags in `getDb`.
 */

/** Validated input for a page of the browse list. */
export const browseListingsInputSchema = z.object({
  /** 1-based page number. Defaults to the first page. */
  page: z.number().int().min(1).default(1),
  /** Page size; clamped to a sane maximum. Defaults to {@link BROWSE_PAGE_SIZE}. */
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(BROWSE_PAGE_SIZE),
  /**
   * Free-text search over name/address (#34). Empty/whitespace → no constraint.
   * Threaded through so the GF taxonomy filter (#35) composes with search via
   * `and(...)` — the count and page reflect search + filters together.
   */
  q: z.string().max(256).optional(),
  /**
   * Selected GF taxonomy attributes to filter by (#35), validated against the
   * fixed `claim_attribute` enum so an unknown value can never reach the query.
   * A listing matches only when each selected attribute has positive community
   * consensus (confirms outnumber disputes) — see `./filter.ts`. Empty/omitted →
   * no taxonomy constraint.
   */
  attrs: z.array(z.enum(claimAttributes)).default([]),
  /**
   * Sort order (#36). One of the {@link BrowseSort} tokens; an unknown token
   * degrades to the stable {@link DEFAULT_BROWSE_SORT} (alphabetical) rather than
   * erroring. COMBINABLE with search + filters — sort only changes `ORDER BY`,
   * never the `WHERE`, so the filtered total + pagination stay correct.
   */
  sort: z.enum(BROWSE_SORT_VALUES as [BrowseSort, ...BrowseSort[]]).catch(DEFAULT_BROWSE_SORT),
  /**
   * The user's location for the "near me" distance sort (#37). Optional and
   * validated to WGS84 ranges; only USED as a complete pair when `sort=distance`.
   * When `sort=distance` but coords are absent (geolocation denied/unavailable,
   * or SSR before the browser grants permission), the loader FALLS BACK to the
   * default alphabetical order rather than erroring — the sort never crashes the
   * page. Coords are ignored entirely for any non-distance sort.
   */
  userLat: z.number().finite().min(-90).max(90).optional(),
  userLng: z.number().finite().min(-180).max(180).optional(),
});
export type BrowseListingsInput = z.infer<typeof browseListingsInputSchema>;

/** One browse card's data: the listing plus its precomputed trust glance. */
export interface BrowseListingCard {
  listing: Listing;
  glance: ListingTrustGlance;
  /**
   * A "0.4 mi" distance label, present ONLY when the page is distance-sorted
   * with a complete user coordinate pair. Reused from the distance-sort path's
   * haversine (never recomputed client-side); omitted for every other sort.
   */
  distanceLabel?: string;
}

/** A page of browse cards plus the cursor info the UI needs to paginate. */
export interface BrowseListingsPage {
  cards: BrowseListingCard[];
  page: number;
  pageSize: number;
  /** The sort applied to this page (echoed back so the UI can reflect state). */
  sort: BrowseSort;
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
 */
export async function getBrowseListings(
  input: BrowseListingsInput,
  now: Date = new Date(),
  stalenessMonths?: number
): Promise<BrowseListingsPage> {
  const db = getDb();
  const { page, pageSize, sort } = input;
  const offset = (page - 1) * pageSize;

  // Compose the WHERE from the text search (#34) and the GF taxonomy filter
  // (#35), AND-combined. The SAME predicate constrains both the page query and
  // the count query, so the total reflects the active filters and pagination
  // stays correct. `undefined` (nothing selected) → drizzle applies no WHERE.
  //
  // Visibility (#41): this is a PUBLIC read, so non-`visible` listings
  // (hidden/removed) are excluded — `AND`-folded with the search/filter so the
  // page, the total count, and pagination all reflect ONLY visible listings.
  const visibleListing = eq(listings.moderationStatus, "visible");
  const searchAndFilter = buildBrowseWhere(buildSearchPredicate(input.q ?? ""), input.attrs);
  const where = searchAndFilter ? and(visibleListing, searchAndFilter) : visibleListing;

  // The ORDER BY (#36). Search/filter live in the WHERE above; sort only touches
  // the ORDER BY, so the three compose cleanly. The trust sort joins a per-listing
  // celiac-trust subquery and ranks by the SAME displayed safety tier (confirm/
  // dispute counts + `lastConfirmedAt` staleness), a roll-up of visible evidence,
  // NOT an opaque score (ADR-007). Resolve the staleness window ONCE so the SQL
  // "stale" boundary matches the boundary the displayed glance uses (below).
  const resolvedStalenessMonths = stalenessMonths ?? DEFAULT_STALENESS_MONTHS;
  const trust = celiacTrustSubquery();
  // Distance sort needs a COMPLETE coordinate pair; a half-pair (or none) means
  // we can't compute distance, so `buildOrderBy` falls back to the default order.
  const coords: Coords | undefined =
    input.userLat !== undefined && input.userLng !== undefined
      ? { lat: input.userLat, lng: input.userLng }
      : undefined;
  const orderBy = buildOrderBy(sort, trust, now, resolvedStalenessMonths, coords);

  // Only compute a distance VALUE when actually distance-sorting with a complete
  // coord pair — the label is shown solely in that case (Phase 2a). We reuse the
  // SAME haversine the ordering derives from (`distanceKmExpr`), so the label and
  // the sort never disagree, and no distance is computed for other sorts.
  const distanceKm = sort === "distance" && coords ? distanceKmExpr(coords) : null;

  // 1. The page of listings under the current search + filter + sort, plus the
  //    matching total (same `WHERE`) so the UI can render "X of Y" + has-more.
  //    The trust subquery is LEFT JOINed so the sort can order by its columns;
  //    rows are wrapped as `{ listing }` because of the projection. When
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

  // No listings on this page → return early; the batched signal queries below
  // would otherwise run `IN ()` (empty), which is wasteful.
  if (pageListings.length === 0) {
    return { cards: [], page, pageSize, sort, total, hasMore: false };
  }

  const pageRows = pageListings.map((row) => row.listing);

  // The per-row distance (km), keyed by listing id, when distance-sorting. Some
  // rows in tests (or a non-distance sort) omit the column; a missing/NaN value
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

  const listingIds = pageRows.map((listing) => listing.id);

  // 2. + 3. Batch the two trust signals for exactly this page's listings.
  const [celiacAggregates, recentIncidentDates] = await Promise.all([
    getCeliacAggregatesByListing(listingIds),
    getRecentIncidentDatesByListing(listingIds, now),
  ]);

  const cards: BrowseListingCard[] = pageRows.map((listing) => {
    const celiac = celiacAggregates.get(listing.id) ?? null;
    const km = distanceByListing.get(listing.id);
    const glance = deriveListingTrustGlance(
      celiac?.aggregate ?? null,
      celiac?.contributors ?? 0,
      recentIncidentDates.get(listing.id) ?? null,
      now,
      resolvedStalenessMonths
    );
    // Distance label only when distance-sorting produced a value for this row.
    // Spread it in conditionally so the optional prop is truly absent (not
    // `undefined`) under `exactOptionalPropertyTypes`.
    return km !== undefined
      ? { listing, glance, distanceLabel: formatDistanceLabel(km) }
      : { listing, glance };
  });

  return { cards, page, pageSize, sort, total, hasMore: offset + pageRows.length < total };
}

/**
 * Subquery: per listing, the headline celiac claim's VISIBLE evidence — the raw
 * confirm/dispute counts and the recency timestamp the at-a-glance trust derives
 * from. We expose the raw counts (not just net) because the trust sort must
 * reproduce the displayed safety TIER, which needs the contested check
 * (`confirms <= disputes`) and the staleness comparison — the exact same signals
 * `deriveHeadlineSafetyState` reads (ADR-007).
 *
 * - `confirmCount` / `disputeCount` — confirm and dispute tallies on the
 *   `celiac_safe_vs_gluten_friendly` claim.
 * - `lastConfirmedAt` — the claim's stored recency signal (NULL until first
 *   confirm; only confirms bump it).
 *
 * Listings with no such claim have no row here (LEFT JOIN yields NULL → the
 * ORDER BY treats them as the lowest tier, so they sort last). This is a roll-up
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
      // Visibility (#41): only `visible` claims feed the trust sort, so a hidden/
      // removed claim cannot influence ordering (matches the displayed glance).
      .where(
        sql`${claims.attribute} = 'celiac_safe_vs_gluten_friendly' and ${claims.moderationStatus} = 'visible'`
      )
      .groupBy(claims.listingId, claims.lastConfirmedAt)
      .as("celiac_trust")
  );
}

type CeliacTrustSubquery = ReturnType<typeof celiacTrustSubquery>;

/**
 * The explicit ORDER BY for each sort (#36). Defined here so the ordering rules
 * are single-sourced and the registry in `app/listings/sort.ts` stays the only
 * other place to touch when adding a sort.
 *
 * SAFETY-CRITICAL — the "trust" order MUST reproduce the same safety TIER the
 * card displays (ADR-007: the sort must be derivable from the visible glance). A
 * naive "net confirms desc" would rank a 30-confirm listing the card itself
 * flags as "may be stale" — or a contested 20/18 listing — ABOVE a fresh,
 * uncontested 3/0 celiac-safe listing, sending a celiac to a place the product
 * down-ranks. So the trust sort orders by tier FIRST, mirroring
 * `deriveHeadlineSafetyState` over the SAME signals (`confirmCount`,
 * `disputeCount`, staleness against `lastConfirmedAt`):
 *
 *   tier 4  celiac-safe  — has evidence, confirms > disputes, fresh (within window)
 *   tier 3  stale        — has evidence, confirms > disputes, but past the window
 *   tier 2  contested    — has evidence, confirms <= disputes (gluten-friendly)
 *   tier 1  unattested   — no celiac claim / no attestation evidence
 *
 * Within a tier we order by net confirms (confirms − disputes) desc, then most
 * recently confirmed (`lastConfirmedAt DESC NULLS LAST`), then name. The
 * staleness cutoff is the caller's `now − stalenessMonths` so the SQL boundary
 * matches the displayed glance EXACTLY (no drift between sort and card).
 *
 * v1 NOTE: recent incidents deliberately do NOT influence the trust sort. The
 * card still shows the incident flag, so the warning remains visible; folding
 * incident-demotion into the ordering is a later issue, not v1.
 *
 * "near me" (#37): the `distance` case orders by the great-circle (haversine)
 * distance from the user's coords (`coords`) to each listing's stored lat/lng,
 * ascending — the SAME formula as the pure `haversineKm` helper, in SQL. When no
 * coords are supplied (geolocation denied/unavailable, or SSR) it falls back to
 * the alphabetical default rather than erroring, so the sort degrades gracefully.
 *
 * Every sort ends with `name ASC` as a stable tiebreaker so the order is
 * deterministic (no arbitrary row shuffling between requests).
 */
function buildOrderBy(
  sort: BrowseSort,
  trust: CeliacTrustSubquery,
  now: Date,
  stalenessMonths: number,
  coords?: Coords
): SQL[] {
  const nameTiebreak = asc(listings.name);

  // The staleness cutoff instant, derived from the SAME shared `stalenessCutoff`
  // helper the glance's `isStale` uses, so the SQL boundary equals the displayed
  // one EXACTLY (no drift between sort and card). Bound as a parameter below.
  const cutoff = stalenessCutoff(now, stalenessMonths);

  const hasEvidence = sql`coalesce(${trust.confirmCount}, 0) + coalesce(${trust.disputeCount}, 0) > 0`;
  const confirmsLead = sql`coalesce(${trust.confirmCount}, 0) > coalesce(${trust.disputeCount}, 0)`;
  // "Fresh" mirrors `isStale` exactly:
  //  - INCLUSIVE lower bound (`>=`): a confirmation EXACTLY on the staleness edge
  //    is fresh, matching `isStale`'s `age > window` rule (stale only once age
  //    STRICTLY exceeds the window). A bare `>` would flip the exact-edge instant
  //    to stale in SQL while the card showed it fresh.
  //  - NULL lastConfirmedAt is fresh, NOT stale: a confirm-majority claim that
  //    has never been confirmed is "not yet confirmed", which `isStale(null)`
  //    treats as not-stale → celiac-safe (tier 4). Bare `lastConfirmedAt >= cutoff`
  //    is NULL (false) for a null timestamp, which would wrongly demote it to the
  //    stale tier (3); the explicit `IS NULL` keeps SQL and JS on the same tier.
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
      // (Independent of tier by design: "recency" answers "what was just
      // re-verified", a different question than "what is safest".)
      return [sql`${recency} desc nulls last`, desc(netConfirms), nameTiebreak];
    case "distance": {
      // "Near me" (#37). Without a complete user coordinate pair (geolocation
      // denied/unavailable, or SSR before the browser grants permission) we
      // CANNOT compute distance, so we fall back to the stable alphabetical order
      // rather than erroring — the sort degrades gracefully, never crashes.
      if (!coords) {
        return [nameTiebreak];
      }
      // Closest first: order by great-circle distance from the user's coords to
      // each listing's stored lat/lng. This is the SAME haversine the pure
      // `haversineKm` helper computes (the explainable, shared definition of
      // "distance"), expressed in SQL so the DB does the ranking. We omit the
      // constant `2 * R` multiplier and the final `asin`/`sqrt` — both are
      // monotonic in the haversine term `h`, so ordering by `h` ascending yields
      // the identical order as the full helper while keeping the SQL cheap.
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
 * The great-circle distance in KILOMETRES from `coords` to each listing's stored
 * lat/lng, as a SQL expression — the FULL haversine (`2 * R * asin(sqrt(h))`),
 * NOT the ordering-only `h` term `buildOrderBy` uses. We need the actual value
 * (not just a monotonic rank) to render a "0.4 mi" label, so this is the exact
 * SQL analogue of the pure `haversineKm` helper (same `EARTH_RADIUS_KM`), keeping
 * the displayed distance and the ordering derived from the same definition.
 *
 * Selected into the page query ONLY when distance-sorting with a complete coord
 * pair (below), so a non-distance sort pays nothing for it.
 */
function distanceKmExpr(coords: Coords): SQL<number> {
  const h = sql`
    sin(radians(${listings.lat} - ${coords.lat}) / 2) ^ 2
    + cos(radians(${coords.lat})) * cos(radians(${listings.lat}))
    * sin(radians(${listings.lng} - ${coords.lng}) / 2) ^ 2`;
  return sql<number>`2 * ${EARTH_RADIUS_KM} * asin(least(1, sqrt(${h})))`;
}

/** A listing's celiac aggregate plus its distinct-contributor count. */
interface CeliacAggregateWithContributors {
  aggregate: ClaimAggregate;
  /** Distinct people who attested (confirm OR dispute) the celiac claim. */
  contributors: number;
}

/**
 * Batch-load the `celiac_safe_vs_gluten_friendly` claim aggregate (confirm/
 * dispute counts + recency) AND the distinct-contributor count for each of
 * `listingIds`, in ONE grouped query.
 *
 * Mirrors `getListingClaimAggregates`'s conditional-count pattern but scoped to
 * the single headline attribute and across many listings (`listingId IN (…)`),
 * so the browse page needs one query for all cards rather than one per card
 * (NO N+1). Contributors is computed IN THE SAME grouped query as a
 * `count(distinct user_id)` over the LEFT-joined `attestations` — the unique
 * `(claim_id, user_id)` constraint means one row per person per claim, so a
 * distinct count of `user_id` is exactly "how many different people weighed in".
 * The LEFT JOIN yields a single NULL `user_id` row for a claim with no
 * attestations, which `count(distinct …)` correctly counts as `0`.
 *
 * Returns a map keyed by `listingId`; a listing with no celiac claim is absent
 * (the caller treats that as "no evidence" → "Not yet attested").
 */
async function getCeliacAggregatesByListing(
  listingIds: string[]
): Promise<Map<string, CeliacAggregateWithContributors>> {
  const rows = await getDb()
    .select({
      listingId: claims.listingId,
      claimId: claims.id,
      lastConfirmedAt: claims.lastConfirmedAt,
      confirmCount: sql<number>`count(*) filter (where ${attestations.value} = 'confirm')`,
      disputeCount: sql<number>`count(*) filter (where ${attestations.value} = 'dispute')`,
      // Distinct people who attested this claim either way — the "N neighbors"
      // evidence count. Computed IN this grouped query (no extra round-trip), so
      // it stays batched (no N+1). NULL user_id (no attestations) counts as 0.
      contributors: sql<number>`count(distinct ${attestations.userId})`,
    })
    .from(claims)
    .leftJoin(attestations, eq(attestations.claimId, claims.id))
    // Visibility (#41): only `visible` claims contribute to a card's headline
    // celiac aggregate, so a hidden/removed claim drops out and the confirm/
    // dispute counts recompute from the survivors.
    .where(
      sql`${claims.listingId} in ${listingIds} and ${claims.attribute} = 'celiac_safe_vs_gluten_friendly' and ${claims.moderationStatus} = 'visible'`
    )
    .groupBy(claims.listingId, claims.id, claims.lastConfirmedAt);

  const byListing = new Map<string, CeliacAggregateWithContributors>();
  for (const row of rows) {
    byListing.set(row.listingId, {
      aggregate: {
        claimId: row.claimId,
        lastConfirmedAt: row.lastConfirmedAt,
        confirmCount: Number(row.confirmCount),
        disputeCount: Number(row.disputeCount),
      },
      contributors: Number(row.contributors),
    });
  }
  return byListing;
}

/**
 * Batch-load incidents for `listingIds` in ONE query and reduce to a map from
 * listing id → the most recent RECENT incident's instant (within #30's recency
 * window), or absent when the listing has no recent incident. Uses the same pure
 * `findRecentIncident` helper the listing-detail banner uses, so "recent" means
 * exactly the same thing on the card as on the detail page.
 *
 * The returned `Date` is the incident day at UTC midnight (incidents are stored
 * as calendar dates, no time-of-day), so the card's freshness cue can phrase
 * "Reported Nd ago" from the incident's own recency without fabricating a time.
 */
async function getRecentIncidentDatesByListing(
  listingIds: string[],
  now: Date
): Promise<Map<string, Date>> {
  const rows = await getDb()
    .select({ listingId: incidents.listingId, occurredOn: incidents.occurredOn })
    .from(incidents)
    // Visibility (#41): a hidden/removed incident no longer flags the card's
    // recent-incident signal — only `visible` incidents count. This is the
    // trust-model guarantee in reverse: moderation can drop a moderated-away
    // incident, but a real, still-visible recent incident is never buried.
    .where(
      and(inArray(incidents.listingId, listingIds), eq(incidents.moderationStatus, "visible"))
    );

  // Group incidents per listing, then ask `findRecentIncident` per group so the
  // window definition stays single-sourced (#30).
  const byListing = new Map<string, { occurredOn: string }[]>();
  for (const row of rows) {
    // Normalize the driver's `date` value to the canonical YYYY-MM-DD string the
    // recency helpers contract on (Neon HTTP returns a `date` as a Date — see
    // toCalendarDayString / issue #45), so the card's recent-incident flag and
    // the most-recent tiebreak are correct.
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
