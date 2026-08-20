import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AttestationValue, ClaimAttribute } from "~/db/schema";
import { removeVote, submitVote } from "~/server/attestations/attestations.fn";
import { claimsQueryKey } from "./CommunityClaims";

/**
 * The ONE client seam for casting/retracting the viewer's own attestation on a
 * listing (AUB-231 — extracted from `ClaimVoteControls` so the ClaimCardDeck's
 * listing-detail host reuses the exact same mutation semantics instead of
 * duplicating them).
 *
 * Both mutations' `onSuccess` RETURN the {@link claimsQueryKey} invalidation
 * promise, so `isPending` holds until the roll-up refetch settles — a caller
 * that branches on `viewerVote` (the toggle) can't act on a stale vote, and
 * the counts, recency, viewer-vote highlights, and the hero's headline badge
 * all recompute from fresh, visible evidence (ADR-007).
 *
 * UI concerns (toasts, undo affordances) stay with the caller via
 * mutate-level callbacks — `vote.mutate(vars, { onSuccess, onError })` — which
 * run in addition to (and, for `onSuccess`, after) the invalidation here.
 * All writes are re-gated + scoped to the current user's own row server-side.
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
