import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { AttestationValue, ClaimAttribute } from "~/db/schema";
import { removeVote, submitVote } from "~/server/attestations/attestations.fn";
import { claimsQueryKey } from "./CommunityClaims";
import { FlagControl } from "./FlagControl";

interface ClaimVoteControlsProps {
  listingId: string;
  /**
   * The taxonomy attribute this row attests (#150). Votes are addressed by
   * `(listingId, attribute)` — the claim row is created lazily server-side on
   * the first vote — so the controls work even when no claim exists yet.
   */
  attribute: ClaimAttribute;
  /**
   * The materialized claim's id, or `null` when no one has attested this
   * attribute yet. Only used to gate the "Flag claim" control (#39): there is
   * nothing to flag until a claim row exists.
   */
  claimId: string | null;
  /** The viewer's current vote on this attribute, or `null` if they haven't voted. */
  viewerVote: AttestationValue | null;
  /** Whether the viewer is signed in — gates the controls (UX only). */
  isSignedIn: boolean;
}

/**
 * Per-attribute confirm/dispute/retract controls (#28 server logic, wired here
 * for #32 — a user casting, CHANGING, or RETRACTING their OWN attestation —
 * extended in #150 to attest by `(listingId, attribute)` with lazy claim
 * creation so EVERY taxonomy attribute is attestable, not just ones with an
 * existing claim row).
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
  attribute,
  claimId,
  viewerVote,
  isSignedIn,
}: ClaimVoteControlsProps) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: claimsQueryKey(listingId) });
  };

  const vote = useMutation({
    mutationFn: (value: AttestationValue) => submitVote({ data: { listingId, attribute, value } }),
    onSuccess: invalidate,
  });

  const retract = useMutation({
    mutationFn: () => removeVote({ data: { listingId, attribute } }),
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
        {/* Iconised confirm/dispute (AUB-131). The PRESSED state maps to the
            celiac-safe (confirm) / incident (dispute) fills so the viewer's own
            vote reads as the same colour language as the rest of the page; the
            lucide check/x shape + the visible text label keep the meaning off
            colour alone. Server calls are unchanged. */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-pressed={viewerVote === "confirm"}
          disabled={busy}
          onClick={() => vote.mutate("confirm")}
          className={
            viewerVote === "confirm"
              ? "border-celiac-safe bg-celiac-safe text-celiac-safe-foreground hover:bg-celiac-safe/90 hover:text-celiac-safe-foreground"
              : undefined
          }
        >
          <Check aria-hidden="true" className="size-4" />
          Confirm
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-pressed={viewerVote === "dispute"}
          disabled={busy}
          onClick={() => vote.mutate("dispute")}
          className={
            viewerVote === "dispute"
              ? "border-incident bg-incident text-incident-foreground hover:bg-incident/90 hover:text-incident-foreground"
              : undefined
          }
        >
          <X aria-hidden="true" className="size-4" />
          Dispute
        </Button>
        {viewerVote !== null ? (
          <Button
            type="button"
            size="sm"
            variant="link"
            disabled={busy}
            onClick={() => retract.mutate()}
          >
            Retract
          </Button>
        ) : null}
        {/* Flag this claim as inappropriate/spam/wrong (#39). Login-gated; the
            server re-gates regardless, so the control is UX only. There is
            nothing to flag until a claim row exists (#150), so it's gated on a
            materialized claim id. */}
        {claimId !== null ? (
          <FlagControl
            target="claim"
            claimId={claimId}
            isSignedIn={isSignedIn}
            label="Flag claim"
          />
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
