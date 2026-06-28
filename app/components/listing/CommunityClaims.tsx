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
  /** Every claim on the listing with its aggregate (counts + recency + own vote). */
  claims: ListingClaimAggregate[];
  /**
   * The signed-in viewer's user id, or `null` when anonymous. When signed in,
   * each claim shows confirm/dispute/retract controls so the viewer can cast,
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
 * The "Community claims" surface on listing detail (issue #29): the transparent
 * per-claim trust roll-up — each claim's confirm/dispute distribution + recency
 * — derived entirely from visible evidence (ADR-007).
 *
 * Renders one {@link ClaimTrustSummaryRow} per claim, with {@link ClaimVoteControls}
 * below it so a signed-in viewer can confirm/dispute and change or retract their
 * OWN vote (#32). When the listing has no claims at all, it renders nothing here
 * and the caller keeps the honest "coming soon" placeholder copy.
 */
export function CommunityClaims({
  listingId,
  claims,
  viewerId,
  now,
  stalenessMonths,
}: CommunityClaimsProps) {
  if (claims.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {claims.map((claim) => (
        <li key={claim.claimId} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
          <ClaimTrustSummaryRow
            attribute={claim.attribute}
            aggregate={claim}
            now={now}
            stalenessMonths={stalenessMonths}
          />
          <ClaimVoteControls
            listingId={listingId}
            claimId={claim.claimId}
            viewerVote={claim.viewerVote}
            isSignedIn={viewerId !== null}
          />
        </li>
      ))}
    </ul>
  );
}
