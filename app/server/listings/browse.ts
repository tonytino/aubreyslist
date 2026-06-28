import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import { type Listing, attestations, claims, incidents, listings } from "~/db/schema";
import type { ClaimAggregate } from "~/server/attestations";
import { type ListingTrustGlance, deriveListingTrustGlance } from "~/trust/browse-glance";
import { findRecentIncident } from "~/trust/incident-recency";

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
  /** Total listing count (across all pages) for "showing X of Y" + paging. */
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
  const { page, pageSize } = input;
  const offset = (page - 1) * pageSize;

  // 1. The page of listings (alphabetical — a stable, scannable default order).
  //    One extra query for the total so the UI can render "X of Y" + has-more.
  const [pageListings, totalRows] = await Promise.all([
    db.select().from(listings).orderBy(asc(listings.name)).limit(pageSize).offset(offset),
    db.select({ total: sql<number>`count(*)` }).from(listings),
  ]);

  const total = Number(totalRows[0]?.total ?? 0);

  // No listings on this page → return early; the batched signal queries below
  // would otherwise run `IN ()` (empty), which is wasteful.
  if (pageListings.length === 0) {
    return { cards: [], page, pageSize, total, hasMore: false };
  }

  const listingIds = pageListings.map((listing) => listing.id);

  // 2. + 3. Batch the two trust signals for exactly this page's listings.
  const [celiacAggregates, recentIncidentIds] = await Promise.all([
    getCeliacAggregatesByListing(listingIds),
    getRecentIncidentListingIds(listingIds, now),
  ]);

  const cards: BrowseListingCard[] = pageListings.map((listing) => ({
    listing,
    glance: deriveListingTrustGlance(
      celiacAggregates.get(listing.id) ?? null,
      recentIncidentIds.has(listing.id),
      now,
      stalenessMonths
    ),
  }));

  return { cards, page, pageSize, total, hasMore: offset + pageListings.length < total };
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
