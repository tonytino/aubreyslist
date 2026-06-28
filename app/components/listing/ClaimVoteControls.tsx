import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AttestationValue } from "~/db/schema";
import { removeVote, submitVote } from "~/server/attestations/attestations.fn";
import { claimsQueryKey } from "./CommunityClaims";

interface ClaimVoteControlsProps {
  listingId: string;
  claimId: string;
  /** The viewer's current vote on this claim, or `null` if they haven't voted. */
  viewerVote: AttestationValue | null;
  /** Whether the viewer is signed in — gates the controls (UX only). */
  isSignedIn: boolean;
}

/**
 * Per-claim confirm/dispute/retract controls (#28 server logic, wired here for
 * #32 — a user casting, CHANGING, or RETRACTING their OWN attestation).
 *
 * One vote per user per claim (domain.md): the upsert in `castVote` changes the
 * existing vote, and `retractVote` deletes it. The "retract" affordance shows
 * only when the viewer has a vote to retract. All writes are re-gated +
 * scoped to the current user's own row server-side; the controls are UX only.
 *
 * After any change the listing's claim roll-up query is invalidated so the
 * counts, recency, the viewer's own vote highlight, and the headline cue all
 * recompute from fresh, visible evidence.
 */
export function ClaimVoteControls({
  listingId,
  claimId,
  viewerVote,
  isSignedIn,
}: ClaimVoteControlsProps) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: claimsQueryKey(listingId) });
  };

  const vote = useMutation({
    mutationFn: (value: AttestationValue) => submitVote({ data: { claimId, value } }),
    onSuccess: invalidate,
  });

  const retract = useMutation({
    mutationFn: () => removeVote({ data: { claimId } }),
    onSuccess: invalidate,
  });

  if (!isSignedIn) {
    return (
      <p className="text-body-sm text-muted-foreground">
        <a href="/api/auth/google" className="underline underline-offset-4">
          Sign in
        </a>{" "}
        to confirm or dispute this.
      </p>
    );
  }

  const busy = vote.isPending || retract.isPending;
  const error = vote.error ?? retract.error;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={viewerVote === "confirm"}
          disabled={busy}
          onClick={() => vote.mutate("confirm")}
          className={`rounded-card border px-3 py-1.5 text-body-sm font-medium disabled:opacity-50 ${
            viewerVote === "confirm"
              ? "border-brand bg-brand text-brand-foreground"
              : "border-border text-foreground hover:bg-surface"
          }`}
        >
          Confirm
        </button>
        <button
          type="button"
          aria-pressed={viewerVote === "dispute"}
          disabled={busy}
          onClick={() => vote.mutate("dispute")}
          className={`rounded-card border px-3 py-1.5 text-body-sm font-medium disabled:opacity-50 ${
            viewerVote === "dispute"
              ? "border-incident bg-incident text-brand-foreground"
              : "border-border text-foreground hover:bg-surface"
          }`}
        >
          Dispute
        </button>
        {viewerVote !== null ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => retract.mutate()}
            className="text-body-sm font-medium underline underline-offset-4 hover:text-brand disabled:opacity-50"
          >
            Retract
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-body-sm text-incident">
          {error instanceof Error ? error.message : "Could not record your vote. Please try again."}
        </p>
      ) : null}
    </div>
  );
}
