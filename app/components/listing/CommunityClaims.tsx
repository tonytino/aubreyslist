import type { ListingClaimAggregate } from "~/server/attestations/listing-summary";
import { ClaimTrustSummaryRow } from "./ClaimTrustSummary";

interface CommunityClaimsProps {
  /** Every claim on the listing with its aggregate (counts + recency). */
  claims: ListingClaimAggregate[];
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
 * Renders one {@link ClaimTrustSummaryRow} per claim. When the listing has no
 * claims at all, it renders nothing here and the caller keeps the honest
 * "coming soon" placeholder copy instead of inventing data.
 */
export function CommunityClaims({ claims, now, stalenessMonths }: CommunityClaimsProps) {
  if (claims.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {claims.map((claim) => (
        <li key={claim.claimId} className="py-3 first:pt-0 last:pb-0">
          <ClaimTrustSummaryRow
            attribute={claim.attribute}
            aggregate={claim}
            now={now}
            stalenessMonths={stalenessMonths}
          />
        </li>
      ))}
    </ul>
  );
}
