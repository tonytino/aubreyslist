import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AttestationValue, ClaimAttribute } from "~/db/schema";
import { removeVote, submitVote } from "~/server/attestations/attestations.fn";
import { claimsQueryKey } from "./CommunityClaims";

/**
 * The one client seam for casting/retracting the viewer's own attestation on a
 * listing, shared by the inline vote controls and the claim-deck host so the
 * mutation semantics can never diverge.
 *
 * Both mutations' `onSuccess` return the {@link claimsQueryKey} invalidation
 * promise, so `isPending` holds until the roll-up refetch settles — a caller that
 * branches on `viewerVote` can't act on a stale vote, and every derived surface
 * recomputes from fresh, visible evidence (ADR-007).
 *
 * UI concerns (toasts, undo affordances) stay with the caller via mutate-level
 * callbacks — `vote.mutate(vars, { onSuccess, onError })` — which run in addition
 * to (and, for `onSuccess`, after) the invalidation here. All writes are re-gated
 * and scoped to the current user's own row server-side.
 */
export function useClaimVoteMutations(listingId: string) {
  const queryClient = useQueryClient();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: claimsQueryKey(listingId) });

  const vote = useMutation({
    mutationFn: ({ attribute, value }: { attribute: ClaimAttribute; value: AttestationValue }) =>
      submitVote({ data: { listingId, attribute, value } }),
    onSuccess: () => invalidate(),
  });

  const retract = useMutation({
    mutationFn: ({ attribute }: { attribute: ClaimAttribute }) =>
      removeVote({ data: { listingId, attribute } }),
    onSuccess: () => invalidate(),
  });

  return { vote, retract };
}
