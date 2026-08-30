import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "~/db/client";
import { attestations, claims, incidents, listings } from "~/db/schema";
import type { ListingActivity } from "~/trust/summary";

/**
 * Listing-activity loader — the two values behind the meta row every listing
 * surface renders (browse card, map mini-card, detail hero).
 *
 * Activity is NOT a safety signal (owner decision 2026-08-25). It answers "has
 * anyone weighed in on this listing lately, and how many visitors left happy",
 * so unlike the celiac-safe badge it is not gated on positive consensus. The
 * surfaces that render it carry a tooltip stating exactly that; the honest
 * verdict machinery (`deriveHeadlineSafetyState`, the glance's evidence and
 * freshness cues) is untouched by anything here.
 *
 * Server-only: imports the DB client. The rendering side derives from these
 * raw values through the pure, client-safe `deriveListingActivityMeta`.
 */

/**
 * Batch-load the activity pair for each of `listingIds` in ONE grouped query —
 * one query for the whole browse page, never one per card (no N+1).
 *
 * The shape, per listing:
 *
 * ```sql
 * select c.listing_id,
 *        max(a.created_at)                                as last_activity_at,
 *        count(distinct a.user_id) filter (
 *          where a.value = 'confirm'
 *            and not exists (
 *              select 1 from incidents i
 *              where i.listing_id = c.listing_id
 *                and i.user_id    = a.user_id
 *                and i.moderation_status = 'visible'
 *            )
 *        )                                                as happy_patrons
 * from claims c
 * join attestations a on a.claim_id = c.id
 * join listings   l on l.id = c.listing_id
 * where c.listing_id in (…)
 *   and c.moderation_status = 'visible'
 *   and l.moderation_status = 'visible'
 * group by c.listing_id
 * ```
 *
 * - **`lastActivityAt`** is `MAX(attestations.created_at)` across every visible
 *   claim of the listing, on any attribute, counting confirms and disputes
 *   alike: a dispute is activity too. Incidents deliberately do not bump it —
 *   harm keeps its own, louder signal (the incident chip and banner), and
 *   folding it in here would dress a report up as ordinary upkeep.
 *   `created_at` rather than `updated_at`: the line reports when a vote was
 *   cast, so re-saving the same vote must not refresh it.
 * - **`happyPatrons`** counts DISTINCT users who cast at least one confirm on a
 *   visible claim and have never filed a visible incident on that same
 *   listing. Dispute-only voters are excluded (they are activity, not happy),
 *   and one person confirming five attributes still counts once. The
 *   incident exclusion uses the same `visible` bound as the card's incident
 *   flag, so a moderated-away report cannot silently un-happy a patron.
 *
 * An INNER join (not LEFT): a claim with no attestations contributes nothing,
 * so a listing with zero activity is simply absent from the map and the caller
 * renders the honest empty state.
 *
 * Visibility is bounded on BOTH levels, exactly like `getListingClaimAggregates`:
 *
 * - **Claim** — a hidden or removed claim contributes neither recency nor
 *   patrons, matching the neighbouring browse aggregates.
 * - **Parent listing** — `moderationStatus` has no parent-to-child
 *   propagation, so a moderator hiding a listing leaves its claims `visible`.
 *   The inner join on `listings` is what stops this loader leaking a
 *   moderated-away listing's activity: it is wired into the public, anonymous
 *   `getListingClaims` server fn, which takes a client-supplied listing id, so
 *   without the bound anyone holding a removed listing's id could still read
 *   its real recency and patron count. The listing then falls out of the map
 *   and the caller renders the honest empty state.
 */
export async function getListingActivityByListing(
  listingIds: string[]
): Promise<Map<string, ListingActivity>> {
  if (listingIds.length === 0) {
    return new Map();
  }

  // "This voter never reported an incident here" — a correlated NOT EXISTS
  // over the same listing, scoped to visible incidents. Written as one raw
  // fragment (like the sibling suggestion guard in `./browse.ts`) so it can sit
  // inside the aggregate's FILTER clause.
  const neverReported = sql`not exists (
    select 1 from ${incidents}
    where ${incidents.listingId} = ${claims.listingId}
      and ${incidents.userId} = ${attestations.userId}
      and ${incidents.moderationStatus} = 'visible'
  )`;

  const rows = await getDb()
    .select({
      listingId: claims.listingId,
      lastActivityAt: sql<Date | null>`max(${attestations.createdAt})`,
      happyPatrons: sql<number>`count(distinct ${attestations.userId}) filter (
        where ${attestations.value} = 'confirm' and ${neverReported}
      )`,
    })
    .from(claims)
    .innerJoin(attestations, eq(attestations.claimId, claims.id))
    // Parent visibility, mirroring `getListingClaimAggregates` — see the
    // docstring: this is the only thing keeping a hidden/removed listing's
    // activity off a public, id-addressable read.
    .innerJoin(listings, eq(listings.id, claims.listingId))
    .where(
      and(
        inArray(claims.listingId, listingIds),
        eq(claims.moderationStatus, "visible"),
        eq(listings.moderationStatus, "visible")
      )
    )
    .groupBy(claims.listingId);

  const byListing = new Map<string, ListingActivity>();
  for (const row of rows) {
    byListing.set(row.listingId, {
      // Drivers hand a timestamp back as a Date or an ISO string; normalize so
      // the pure formatter always gets a real Date (or null).
      lastActivityAt: row.lastActivityAt === null ? null : new Date(row.lastActivityAt),
      happyPatrons: Number(row.happyPatrons),
    });
  }
  return byListing;
}

/**
 * The single-listing read for the detail hero. Delegates to the batched loader
 * above so the browse card and the hero can never disagree about what "updated"
 * or "happy patrons" mean. Returns `null` for a listing with no activity, which
 * the caller renders as the honest empty state.
 */
export async function getListingActivity(listingId: string): Promise<ListingActivity | null> {
  const byListing = await getListingActivityByListing([listingId]);
  return byListing.get(listingId) ?? null;
}
