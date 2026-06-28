import { createServerFn } from "@tanstack/react-start";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import { type ClaimAttribute, attestations, claims } from "~/db/schema";
import type { ClaimAggregate } from "~/server/attestations";

/**
 * Listing-level trust roll-up loader (issue #29, ADR-007).
 *
 * Loads every claim on a listing TOGETHER WITH its aggregate (confirm/dispute
 * counts + `lastConfirmedAt` recency) in a single batched query, so the
 * listing-detail "Community claims" surface and the headline celiac-safe vs.
 * gluten-friendly cue render from one round-trip rather than N per-claim
 * {@link getClaimAggregate} calls.
 *
 * Every value returned is derivable from evidence the user can also see — the
 * counts are of the visible `attestations` rows; `lastConfirmedAt` is the stored
 * recency signal. A roll-up of visible evidence, never a secret score (ADR-007).
 *
 * Server-only: imports the DB client. Reads are open/anonymous (no auth gate),
 * matching {@link getClaimAggregate}.
 */

/** A claim plus its aggregate — one entry per existing claim row on the listing. */
export interface ListingClaimAggregate extends ClaimAggregate {
  attribute: ClaimAttribute;
}

/** Reading a listing's claim aggregates needs only the listing id. */
export const listingClaimsInputSchema = z.object({
  listingId: z.string().min(1, "listingId is required"),
});
export type ListingClaimsInput = z.infer<typeof listingClaimsInputSchema>;

/**
 * Load all claims on a listing with their confirm/dispute counts and recency.
 *
 * Single query: LEFT JOIN `claims` → `attestations` (so a claim with zero
 * attestations still returns a row), grouped per claim, with the confirm and
 * dispute counts computed as conditional sums. `lastConfirmedAt` comes straight
 * off the `claims` row. Returns one entry per claim that exists for the listing;
 * a listing with no claims yields `[]`.
 */
export async function getListingClaimAggregates(
  input: ListingClaimsInput
): Promise<ListingClaimAggregate[]> {
  const rows = await getDb()
    .select({
      claimId: claims.id,
      attribute: claims.attribute,
      lastConfirmedAt: claims.lastConfirmedAt,
      // Conditional counts over the joined attestations — derived purely from
      // the visible rows; COUNT-style sums coalesce to 0 when there are none.
      confirmCount: sql<number>`count(*) filter (where ${attestations.value} = 'confirm')`,
      disputeCount: sql<number>`count(*) filter (where ${attestations.value} = 'dispute')`,
    })
    .from(claims)
    .leftJoin(attestations, eq(attestations.claimId, claims.id))
    .where(eq(claims.listingId, input.listingId))
    .groupBy(claims.id, claims.attribute, claims.lastConfirmedAt);

  // `count(...)` arrives as a string/number depending on the driver; coerce to
  // a plain number so the typed surface is honest for downstream derivation.
  return rows.map((row) => ({
    claimId: row.claimId,
    attribute: row.attribute,
    lastConfirmedAt: row.lastConfirmedAt,
    confirmCount: Number(row.confirmCount),
    disputeCount: Number(row.disputeCount),
  }));
}

/** Server function entry point the listing-detail loader calls. */
export const fetchListingClaimAggregates = createServerFn({ method: "GET" })
  .validator(listingClaimsInputSchema)
  .handler(({ data }) => getListingClaimAggregates(data));
