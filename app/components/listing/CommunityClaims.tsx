import type { ListingClaimAggregate } from "~/server/attestations/listing-summary";
import { ClaimTrustSummaryRow } from "./ClaimTrustSummary";
import { ClaimVoteControls } from "./ClaimVoteControls";
import { FlagControl } from "./FlagControl";

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
   * each attribute shows the badge toggle controls so the viewer can cast,
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
 * Each row is a header row — the {@link ClaimTrustSummaryRow} title/roll-up on
 * the left, a compact flag icon-button on the right (only when a claim row
 * exists to flag, #39/#150; `FlagControl` keeps its own login gate) — with
 * {@link ClaimVoteControls} below it so a signed-in viewer can toggle their OWN
 * vote (#32), even on an attribute with no claim row yet, where the claim is
 * created lazily on the first vote (#150). Anonymous viewers see the evidence +
 * a sign-in affordance. There is no longer a "coming soon" dead-end.
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
          <div className="flex items-start justify-between gap-2">
            <ClaimTrustSummaryRow
              attribute={claim.attribute}
              aggregate={claim}
              now={now}
              stalenessMonths={stalenessMonths}
              className="min-w-0 flex-1"
            />
            {/* Flag this claim as inappropriate/spam/wrong (#39), right-aligned
                on the claim's title row. Login-gated inside FlagControl (the
                server re-gates regardless); there is nothing to flag until a
                claim row exists (#150), so it's gated on a materialized id. */}
            {claim.claimId !== null ? (
              <FlagControl
                target="claim"
                claimId={claim.claimId}
                isSignedIn={viewerId !== null}
                label="Flag claim"
                variant="icon"
                triggerClassName="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            ) : null}
          </div>
          <ClaimVoteControls
            listingId={listingId}
            attribute={claim.attribute}
            viewerVote={claim.viewerVote}
            isSignedIn={viewerId !== null}
          />
        </li>
      ))}
    </ul>
  );
}
