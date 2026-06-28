import { type SQL, asc, desc, eq, inArray, sql } from "drizzle-orm";
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
import { BROWSE_SORT_VALUES, type BrowseSort, DEFAULT_BROWSE_SORT } from "~/listings/sort";
import type { ClaimAggregate } from "~/server/attestations";
import { type ListingTrustGlance, deriveListingTrustGlance } from "~/trust/browse-glance";
import { findRecentIncident } from "~/trust/incident-recency";
import { DEFAULT_STALENESS_MONTHS } from "~/trust/summary";
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

/** Default and max page size for the browse list. */
export const BROWSE_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

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
});
export type BrowseListingsInput = z.infer<typeof browseListingsInputSchema>;

/** One browse card's data: the listing plus its precomputed trust glance. */
export interface BrowseListingCard {
  listing: Listing;
  glance: ListingTrustGlance;
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
  const where = buildBrowseWhere(buildSearchPredicate(input.q ?? ""), input.attrs);

  // The ORDER BY (#36). Search/filter live in the WHERE above; sort only touches
  // the ORDER BY, so the three compose cleanly. The trust sort joins a per-listing
  // celiac-trust subquery and ranks by the SAME displayed safety tier (confirm/
  // dispute counts + `lastConfirmedAt` staleness), a roll-up of visible evidence,
  // NOT an opaque score (ADR-007). Resolve the staleness window ONCE so the SQL
  // "stale" boundary matches the boundary the displayed glance uses (below).
  const resolvedStalenessMonths = stalenessMonths ?? DEFAULT_STALENESS_MONTHS;
  const trust = celiacTrustSubquery();
  const orderBy = buildOrderBy(sort, trust, now, resolvedStalenessMonths);

  // 1. The page of listings under the current search + filter + sort, plus the
  //    matching total (same `WHERE`) so the UI can render "X of Y" + has-more.
  //    The trust subquery is LEFT JOINed so the sort can order by its columns;
  //    rows are wrapped as `{ listing }` because of the projection.
  const [pageListings, totalRows] = await Promise.all([
    db
      .select({ listing: listings })
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

  const listingIds = pageRows.map((listing) => listing.id);

  // 2. + 3. Batch the two trust signals for exactly this page's listings.
  const [celiacAggregates, recentIncidentIds] = await Promise.all([
    getCeliacAggregatesByListing(listingIds),
    getRecentIncidentListingIds(listingIds, now),
  ]);

  const cards: BrowseListingCard[] = pageRows.map((listing) => ({
    listing,
    glance: deriveListingTrustGlance(
      celiacAggregates.get(listing.id) ?? null,
      recentIncidentIds.has(listing.id),
      now,
      resolvedStalenessMonths
    ),
  }));

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
  return getDb()
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
    .where(sql`${claims.attribute} = 'celiac_safe_vs_gluten_friendly'`)
    .groupBy(claims.listingId, claims.lastConfirmedAt)
    .as("celiac_trust");
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
 * EXTENSIBLE: adding #37's `distance` is a new `case` here (ordering by the
 * haversine distance from the user's lat/lng) plus its registry entry — no
 * rewrite of this function or the loader.
 *
 * Every sort ends with `name ASC` as a stable tiebreaker so the order is
 * deterministic (no arbitrary row shuffling between requests).
 */
function buildOrderBy(
  sort: BrowseSort,
  trust: CeliacTrustSubquery,
  now: Date,
  stalenessMonths: number
): SQL[] {
  const nameTiebreak = asc(listings.name);

  // The staleness cutoff instant, computed the SAME way the glance does
  // (`isStale`: age > stalenessMonths * 30 days). A confirmation strictly newer
  // than this is "fresh"; null/older is stale. Bound as a parameter so the SQL
  // boundary equals the displayed one.
  const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;
  const stalenessCutoff = new Date(now.getTime() - stalenessMonths * MS_PER_MONTH);

  const hasEvidence = sql`coalesce(${trust.confirmCount}, 0) + coalesce(${trust.disputeCount}, 0) > 0`;
  const confirmsLead = sql`coalesce(${trust.confirmCount}, 0) > coalesce(${trust.disputeCount}, 0)`;
  const fresh = sql`${trust.lastConfirmedAt} > ${stalenessCutoff}`;

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
    default:
      // Alphabetical — the stable, scannable default.
      return [nameTiebreak];
  }
}

/**
 * Batch-load the `celiac_safe_vs_gluten_friendly` claim aggregate (confirm/
 * dispute counts + recency) for each of `listingIds`, in ONE grouped query.
 *
 * Mirrors `getListingClaimAggregates`'s conditional-count pattern but scoped to
 * the single headline attribute and across many listings (`listingId IN (…)`),
 * so the browse page needs one query for all cards rather than one per card.
 * Returns a map keyed by `listingId`; a listing with no celiac claim is absent
 * (the caller treats that as "no evidence" → "Not yet attested").
 */
async function getCeliacAggregatesByListing(
  listingIds: string[]
): Promise<Map<string, ClaimAggregate>> {
  const rows = await getDb()
    .select({
      listingId: claims.listingId,
      claimId: claims.id,
      lastConfirmedAt: claims.lastConfirmedAt,
      confirmCount: sql<number>`count(*) filter (where ${attestations.value} = 'confirm')`,
      disputeCount: sql<number>`count(*) filter (where ${attestations.value} = 'dispute')`,
    })
    .from(claims)
    .leftJoin(attestations, eq(attestations.claimId, claims.id))
    .where(
      sql`${claims.listingId} in ${listingIds} and ${claims.attribute} = 'celiac_safe_vs_gluten_friendly'`
    )
    .groupBy(claims.listingId, claims.id, claims.lastConfirmedAt);

  const byListing = new Map<string, ClaimAggregate>();
  for (const row of rows) {
    byListing.set(row.listingId, {
      claimId: row.claimId,
      lastConfirmedAt: row.lastConfirmedAt,
      confirmCount: Number(row.confirmCount),
      disputeCount: Number(row.disputeCount),
    });
  }
  return byListing;
}

/**
 * Batch-load incidents for `listingIds` in ONE query and reduce to the set of
 * listing ids that have a RECENT incident (within #30's recency window). Uses
 * the same pure `findRecentIncident` helper the listing-detail banner uses, so
 * "recent" means exactly the same thing on the card as on the detail page.
 */
async function getRecentIncidentListingIds(listingIds: string[], now: Date): Promise<Set<string>> {
  const rows = await getDb()
    .select({ listingId: incidents.listingId, occurredOn: incidents.occurredOn })
    .from(incidents)
    .where(inArray(incidents.listingId, listingIds));

  // Group incidents per listing, then ask `findRecentIncident` per group so the
  // window definition stays single-sourced (#30).
  const byListing = new Map<string, { occurredOn: string }[]>();
  for (const row of rows) {
    const list = byListing.get(row.listingId);
    if (list) {
      list.push({ occurredOn: row.occurredOn });
    } else {
      byListing.set(row.listingId, [{ occurredOn: row.occurredOn }]);
    }
  }

  const recent = new Set<string>();
  for (const [listingId, incidentList] of byListing) {
    if (findRecentIncident(incidentList, now) !== null) {
      recent.add(listingId);
    }
  }
  return recent;
}
