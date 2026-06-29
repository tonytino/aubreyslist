import type { ListingClaimAggregate } from "~/server/attestations/listing-summary";
import { ClaimTrustSummaryRow } from "./ClaimTrustSummary";
import { ClaimVoteControls } from "./ClaimVoteControls";

/**
 * Query key for a listing's claim roll-up — shared so a vote change/retract can
 * invalidate it and the counts, recency, viewer's own vote, and headline cue all
 * recompute from fresh evidence (#32).
 */
export function claimsQueryKey(listingId: string): readonly [string, string] {
  return ["listing-claims", listingId];
}

interface CommunityClaimsProps {
  /** The listing these claims belong to — used to invalidate the roll-up query. */
  listingId: string;
  /**
   * The FULL fixed taxonomy as attestable entries — one per attribute (#150),
   * each with its aggregate (counts + recency + own vote). Attributes nobody has
   * attested yet arrive with `claimId: null` and zero counts (honest empty
   * state); the vote path creates the claim lazily on the first vote.
   */
  claims: ListingClaimAggregate[];
  /**
   * The signed-in viewer's user id, or `null` when anonymous. When signed in,
   * each attribute shows confirm/dispute/retract controls so the viewer can cast,
   * change, or retract their OWN attestation (#32). Anonymous viewers see the
   * read-only roll-up with a sign-in prompt.
   */
  viewerId: string | null;
  /** "Now" override for deterministic tests; defaults to current time. */
  now?: Date | undefined;
  /** Admin-tuned staleness window in months (ADR-007). Defaults to 6. */
  stalenessMonths?: number | undefined;
}

/**
 * The "Community claims" surface on listing detail (issue #29, extended for
 * #150): the transparent per-attribute trust roll-up — each attribute's
 * confirm/dispute distribution + recency — derived entirely from visible
 * evidence (ADR-007), with the WHOLE fixed taxonomy ALWAYS rendered as
 * attestable.
 *
 * Renders one {@link ClaimTrustSummaryRow} per taxonomy attribute (honest empty
 * state for zero votes — never a fabricated rating), with {@link ClaimVoteControls}
 * below it so a signed-in viewer can confirm/dispute and change or retract their
 * OWN vote (#32) — even on an attribute with no claim row yet, where the claim is
 * created lazily on the first vote (#150). Anonymous viewers see the evidence + a
 * sign-in affordance. There is no longer a "coming soon" dead-end.
 */
export function CommunityClaims({
  listingId,
  claims,
  viewerId,
  now,
  stalenessMonths,
}: CommunityClaimsProps) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {claims.map((claim) => (
        <li key={claim.attribute} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
          <ClaimTrustSummaryRow
            attribute={claim.attribute}
            aggregate={claim}
            now={now}
            stalenessMonths={stalenessMonths}
          />
          <ClaimVoteControls
            listingId={listingId}
            attribute={claim.attribute}
            claimId={claim.claimId}
            viewerVote={claim.viewerVote}
            isSignedIn={viewerId !== null}
          />
        </li>
      ))}
    </ul>
  );
}
