import { createServerFn } from "@tanstack/react-start";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import {
  type AttestationValue,
  type ClaimAttribute,
  attestations,
  claimAttributes,
  claims,
} from "~/db/schema";
import type { ClaimAggregate } from "~/server/attestations";
import { getCurrentUser } from "~/server/auth/current-user";

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

/**
 * A taxonomy attribute plus its aggregate — ONE ENTRY PER fixed taxonomy
 * attribute (#150), whether or not a `claims` row exists yet.
 *
 * `claimId` is `null` for an attribute nobody has attested yet: there is no
 * materialized claim row, so there is no id, zero counts, and `null` recency.
 * The vote write path creates the row lazily on the first vote (addressed by
 * `(listingId, attribute)`, not by this id), so the UI can render every
 * attribute as attestable from an honest empty state without inventing a rating.
 */
export interface ListingClaimAggregate extends Omit<ClaimAggregate, "claimId"> {
  /** The id of the materialized claim row, or `null` for an un-attested attribute. */
  claimId: string | null;
  attribute: ClaimAttribute;
  /**
   * The CURRENT viewer's own vote on this attribute, or `null` when they have
   * not voted (or are anonymous, or no claim row exists yet). Drives the
   * per-attribute "your vote" affordance and the change/retract controls (#32) —
   * a user editing/retracting their OWN attestation. This is the viewer's own
   * visible evidence, never a hidden score.
   */
  viewerVote: AttestationValue | null;
}

/** Reading a listing's claim aggregates needs only the listing id. */
export const listingClaimsInputSchema = z.object({
  listingId: z.string().min(1, "listingId is required"),
});
export type ListingClaimsInput = z.infer<typeof listingClaimsInputSchema>;

/**
 * Load the FULL fixed taxonomy for a listing as attestable, each attribute with
 * its confirm/dispute counts + recency + the viewer's own vote (#150, #29).
 *
 * The GF taxonomy is curated and fixed (domain.md): conceptually every listing
 * has all 7 attributes available to attest. So this returns ONE ENTRY PER
 * `claimAttributes` value — merging the existing `claims` rows (with their
 * visible counts + recency) and a zero/empty entry (`claimId: null`, zero
 * counts, `null` recency, `null` viewer vote) for attributes nobody has touched
 * yet. The listing-detail surface renders all of them as attestable, so there is
 * an entry point for the lazy-create vote path even when no claim exists.
 *
 * Single aggregate query: LEFT JOIN `claims` → `attestations` (so a claim with
 * zero attestations still returns a row), grouped per claim, with the confirm
 * and dispute counts computed as conditional counts over the VISIBLE
 * attestations. `lastConfirmedAt` comes straight off the `claims` row. Every
 * value is a roll-up of visible evidence — never a fabricated score (ADR-007).
 *
 * Moderation visibility (#41): a hidden/removed claim must not contribute. The
 * write path is the only thing that materializes a claim row, and removed
 * content is deleted (cascading its attestations), so an attribute whose claim
 * has been removed falls back to the zero/empty entry here — exactly "treat as
 * no visible claim".
 */
export async function getListingClaimAggregates(
  input: ListingClaimsInput
): Promise<ListingClaimAggregate[]> {
  const db = getDb();

  const rows = await db
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
    // Visibility (#41): this is a PUBLIC read, so a hidden/removed claim is
    // excluded entirely — it drops off the "Community claims" surface AND out of
    // the headline celiac-safe vs. gluten-friendly cue, whose counts recompute
    // from the surviving visible claims/attestations.
    .where(and(eq(claims.listingId, input.listingId), eq(claims.moderationStatus, "visible")))
    .groupBy(claims.id, claims.attribute, claims.lastConfirmedAt);

  // Index the existing claim rows by attribute so we can merge them onto the
  // full taxonomy below. `count(...)` arrives as a string/number depending on
  // the driver; coerce to a plain number so the typed surface is honest.
  const byAttribute = new Map<
    ClaimAttribute,
    { claimId: string; lastConfirmedAt: Date | null; confirmCount: number; disputeCount: number }
  >();
  for (const row of rows) {
    byAttribute.set(row.attribute, {
      claimId: row.claimId,
      lastConfirmedAt: row.lastConfirmedAt,
      confirmCount: Number(row.confirmCount),
      disputeCount: Number(row.disputeCount),
    });
  }

  // Resolve the viewer's OWN vote per claim so the UI can show + change/retract
  // it (#32). Reads stay open — anonymous viewers simply have no votes, so we
  // skip the query entirely and every `viewerVote` is null.
  const viewer = await getCurrentUser();
  const viewerVotes = new Map<string, AttestationValue>();
  if (viewer) {
    const ownRows = await db
      .select({ claimId: attestations.claimId, value: attestations.value })
      .from(attestations)
      .innerJoin(claims, eq(claims.id, attestations.claimId))
      .where(and(eq(claims.listingId, input.listingId), eq(attestations.userId, viewer.id)));
    for (const own of ownRows) {
      viewerVotes.set(own.claimId, own.value);
    }
  }

  // One entry per fixed taxonomy attribute, in the canonical taxonomy order:
  // the existing claim merged in where present, an honest empty entry otherwise.
  return claimAttributes.map((attribute) => {
    const existing = byAttribute.get(attribute);
    if (!existing) {
      return {
        claimId: null,
        attribute,
        lastConfirmedAt: null,
        confirmCount: 0,
        disputeCount: 0,
        viewerVote: null,
      };
    }
    return {
      claimId: existing.claimId,
      attribute,
      lastConfirmedAt: existing.lastConfirmedAt,
      confirmCount: existing.confirmCount,
      disputeCount: existing.disputeCount,
      viewerVote: viewerVotes.get(existing.claimId) ?? null,
    };
  });
}

/** Server function entry point the listing-detail loader calls. */
export const fetchListingClaimAggregates = createServerFn({ method: "GET" })
  .validator(listingClaimsInputSchema)
  .handler(({ data }) => getListingClaimAggregates(data));
