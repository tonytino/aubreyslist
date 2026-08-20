import { createServerFn } from "@tanstack/react-start";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import {
  type AttestationValue,
  attestations,
  type ClaimAttribute,
  claimAttributes,
  claims,
  listings,
} from "~/db/schema";
import type { ClaimAggregate } from "~/server/attestations";
import { getCurrentUser } from "~/server/auth/current-user";

/**
 * Listing-level trust roll-up loader (ADR-007).
 *
 * Loads every claim on a listing together with its aggregate (confirm/dispute
 * counts + `lastConfirmedAt` recency) in a single batched query, so the
 * listing-detail "Community claims" surface and the headline cue render from
 * one round-trip rather than N per-claim {@link getClaimAggregate} calls.
 *
 * Every value returned is derivable from evidence the user can also see — the
 * counts are of the visible `attestations` rows; `lastConfirmedAt` is the
 * stored recency signal. A roll-up of visible evidence, never a secret score
 * (ADR-007).
 *
 * Server-only: imports the DB client. Reads are open/anonymous (no auth
 * gate), matching {@link getClaimAggregate}.
 */

/**
 * A taxonomy attribute plus its aggregate — one entry per fixed taxonomy
 * attribute, whether or not a `claims` row exists yet.
 *
 * `claimId` is `null` for an attribute nobody has attested yet: no
 * materialized claim row, so no id, zero counts, and `null` recency. The vote
 * write path creates the row lazily on the first vote (addressed by
 * `(listingId, attribute)`, not by this id), so the UI can render every
 * attribute as attestable from an honest empty state without inventing a
 * rating.
 */
export interface ListingClaimAggregate extends Omit<ClaimAggregate, "claimId"> {
  /** The id of the materialized claim row, or `null` for an un-attested attribute. */
  claimId: string | null;
  attribute: ClaimAttribute;
  /**
   * The current viewer's own vote on this attribute, or `null` when they have
   * not voted (or are anonymous, or no claim row exists yet). Drives the
   * per-attribute "your vote" affordance and the change/retract controls.
   * The viewer's own visible evidence, never a hidden score.
   */
  viewerVote: AttestationValue | null;
}

/** Reading a listing's claim aggregates needs only the listing id. */
export const listingClaimsInputSchema = z.object({
  listingId: z.string().min(1, "listingId is required"),
});
export type ListingClaimsInput = z.infer<typeof listingClaimsInputSchema>;

/**
 * Load the full fixed taxonomy for a listing as attestable, each attribute
 * with its confirm/dispute counts + recency + the viewer's own vote.
 *
 * The GF taxonomy is curated and fixed (domain.md): every listing
 * conceptually has all attributes available to attest. Returns one entry per
 * `claimAttributes` value — the existing `claims` rows merged with a
 * zero/empty entry for attributes nobody has touched yet. The listing-detail
 * surface renders all of them as attestable, so the lazy-create vote path has
 * an entry point even when no claim exists.
 *
 * Single aggregate query: LEFT JOIN `claims` → `attestations` (a claim with
 * zero attestations still returns a row), grouped per claim, with confirm and
 * dispute computed as conditional counts over the visible attestations.
 * `lastConfirmedAt` comes off the `claims` row. Every value is a roll-up of
 * visible evidence — never a fabricated score (ADR-007).
 *
 * Moderation visibility: a hidden/removed claim must not contribute.
 * Moderation is soft — `hide`/`remove` flip the claim's `moderationStatus`
 * enum, never deleting the row. The fallback to the zero/empty entry is
 * load-bearing on the `moderation_status = 'visible'` predicate on the
 * aggregate query below: a hidden/removed claim is filtered out of
 * `byAttribute`, so its attribute reads as "no visible claim". Do not remove
 * that predicate thinking it is redundant — it is the only thing keeping
 * moderated evidence off this public surface and out of the headline cue.
 *
 * Parent visibility: `moderationStatus` has no parent→child propagation, so a
 * moderator hiding/removing the listing leaves its claims `visible`. Both
 * queries below inner-join `listings` and additionally require the parent
 * listing to be `visible`, so a moderated-away listing leaks none of its
 * claim aggregates via this addressable per-listing RPC — every attribute
 * falls back to its honest empty entry just as it would for a hidden claim.
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
      // Curator-bot suggestion provenance: non-null ⇒ show the "Suggested by
      // Aubrey's Bot" badge. Not a vote — never folded into counts.
      suggestedBy: claims.suggestedBy,
      // Conditional counts over the joined attestations — derived purely from
      // the visible rows; zero when there are none.
      confirmCount: sql<number>`count(*) filter (where ${attestations.value} = 'confirm')`,
      disputeCount: sql<number>`count(*) filter (where ${attestations.value} = 'dispute')`,
    })
    .from(claims)
    .leftJoin(attestations, eq(attestations.claimId, claims.id))
    // Parent visibility: also require the parent listing to be visible, so a
    // hidden/removed listing leaks none of its claim aggregates (no moderation
    // propagation onto child claims — see the docstring).
    .innerJoin(listings, eq(listings.id, claims.listingId))
    // Visibility: this is a public read, so a hidden/removed claim is excluded
    // entirely — it drops off the "Community claims" surface and out of the
    // headline cue, whose counts recompute from the surviving visible rows.
    .where(
      and(
        eq(claims.listingId, input.listingId),
        eq(claims.moderationStatus, "visible"),
        eq(listings.moderationStatus, "visible")
      )
    )
    .groupBy(claims.id, claims.attribute, claims.lastConfirmedAt, claims.suggestedBy);

  // Index the existing claim rows by attribute so we can merge them onto the
  // full taxonomy below. `count(...)` arrives as a string/number depending on
  // the driver; coerce to a plain number so the typed surface is honest.
  const byAttribute = new Map<
    ClaimAttribute,
    {
      claimId: string;
      lastConfirmedAt: Date | null;
      confirmCount: number;
      disputeCount: number;
      suggested: boolean;
    }
  >();
  for (const row of rows) {
    byAttribute.set(row.attribute, {
      claimId: row.claimId,
      lastConfirmedAt: row.lastConfirmedAt,
      confirmCount: Number(row.confirmCount),
      disputeCount: Number(row.disputeCount),
      suggested: Boolean(row.suggestedBy),
    });
  }

  // Resolve the viewer's own vote per claim so the UI can show and
  // change/retract it. Reads stay open — anonymous viewers have no votes, so
  // the query is skipped and every `viewerVote` is null.
  //
  // Visibility, defense in depth: scope this to `visible` claims too. A vote
  // is only attached when its claim survived into the visible-only
  // `byAttribute` map, but keeping this predicate aligned with the aggregate
  // query means neither can drift to leak moderated evidence.
  const viewer = await getCurrentUser();
  const viewerVotes = new Map<string, AttestationValue>();
  if (viewer) {
    const ownRows = await db
      .select({ claimId: attestations.claimId, value: attestations.value })
      .from(attestations)
      .innerJoin(claims, eq(claims.id, attestations.claimId))
      .innerJoin(listings, eq(listings.id, claims.listingId))
      .where(
        and(
          eq(claims.listingId, input.listingId),
          eq(claims.moderationStatus, "visible"),
          eq(listings.moderationStatus, "visible"),
          eq(attestations.userId, viewer.id)
        )
      );
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
        suggested: false,
        viewerVote: null,
      };
    }
    return {
      claimId: existing.claimId,
      attribute,
      lastConfirmedAt: existing.lastConfirmedAt,
      confirmCount: existing.confirmCount,
      disputeCount: existing.disputeCount,
      suggested: existing.suggested,
      viewerVote: viewerVotes.get(existing.claimId) ?? null,
    };
  });
}

/**
 * Client-callable server-function seam for the listing-detail claim roll-up —
 * the RPC entry point for on-demand refetches (e.g. after a vote). Referenced
 * via TanStack Start's generated server-function manifest rather than an
 * import knip can trace, and it lives outside a `*.fn.ts` file, so it needs
 * the explicit tag.
 * @knippublic server-function seam (see docs/agents/tooling.md → dead-code check)
 */
export const fetchListingClaimAggregates = createServerFn({ method: "GET" })
  .validator(listingClaimsInputSchema)
  .handler(({ data }) => getListingClaimAggregates(data));
