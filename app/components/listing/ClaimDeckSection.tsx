import { useState } from "react";
import { toast } from "sonner";
import {
  ClaimCardDeck,
  type DeckAnswer,
  type DeckAnswerMap,
  emptyDeckAnswers,
} from "~/components/claims/ClaimCardDeck";
import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import type { AttestationValue } from "~/db/schema";
import type { ClaimAttribute } from "~/listings/taxonomy";
import type { ListingClaimAggregate } from "~/server/attestations/listing-summary";
import { useClaimVoteMutations } from "./use-claim-vote-mutations";

/**
 * The listing-detail host for the {@link ClaimCardDeck} (AUB-231): a prominent
 * "Been here? Confirm what you know" CTA at the top of the Claims tab that
 * opens the deck in a bottom sheet on mobile / a centered dialog on ≥sm.
 *
 * Semantics (all owner-approved spec decisions):
 *   - SIGNED-IN ONLY: anonymous viewers see nothing here — the tab's existing
 *     sign-in copy and per-row prompts remain the sign-in path.
 *   - PRE-SEEDED: on open, each card seeds from the viewer's current vote
 *     (`viewerVote`), with a small "You marked this …" caption on pre-voted
 *     cards. The snapshot is taken ONCE per open so mid-flow refetches never
 *     reshuffle the deck.
 *   - IMMEDIATE WRITES: confirm/dispute writes through the SAME
 *     {@link useClaimVoteMutations} seam the inline `ClaimVoteControls` use
 *     (upsert + claims roll-up invalidation), so counts, trust rows, and the
 *     hero badges refresh live.
 *   - SKIP IS SAFE: "Not sure" on an already-voted card leaves the existing
 *     vote untouched (retract stays available via the inline toggles).
 *   - MIS-SWIPE UNDO: every write raises a "Vote recorded · Undo" toast whose
 *     Undo restores the previous state — the previous vote via another upsert,
 *     or a retract when there was none.
 *
 * The sheet never dismisses on horizontal drag (Radix has no drag-to-dismiss;
 * the deck additionally keeps ~24px edge dead zones for the OS back gesture).
 * The existing CommunityClaims list below stays fully functional.
 */
export function ClaimDeckSection({
  listingId,
  claims,
  isSignedIn,
}: {
  listingId: string;
  claims: ListingClaimAggregate[];
  isSignedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Snapshots taken when the deck opens: the deck's answer map, and the
  // viewer's standing votes (for captions, skip semantics, and Undo).
  const [answers, setAnswers] = useState<DeckAnswerMap>(emptyDeckAnswers());
  const [votes, setVotes] = useState<Record<ClaimAttribute, AttestationValue | null>>(() =>
    emptyVotes()
  );
  const { vote, retract } = useClaimVoteMutations(listingId);

  if (!isSignedIn) {
    return null;
  }

  const openDeck = () => {
    const seededAnswers = emptyDeckAnswers();
    const seededVotes = emptyVotes();
    for (const claim of claims) {
      seededVotes[claim.attribute] = claim.viewerVote;
      if (claim.viewerVote !== null) {
        seededAnswers[claim.attribute] = claim.viewerVote;
      }
    }
    setAnswers(seededAnswers);
    setVotes(seededVotes);
    setOpen(true);
  };

  /** Roll one card's answer back to the pre-write state (the Undo action). */
  const undo = (attribute: ClaimAttribute, previous: AttestationValue | null) => {
    const restore = () => {
      setVotes((prev) => ({ ...prev, [attribute]: previous }));
      setAnswers((prev) => ({ ...prev, [attribute]: previous ?? undefined }));
      toast.success(previous === null ? "Vote removed" : "Previous vote restored");
    };
    const fail = () => {
      toast.error("Could not undo. Please try again.");
    };
    if (previous === null) {
      retract.mutate({ attribute }, { onSuccess: restore, onError: fail });
    } else {
      vote.mutate({ attribute, value: previous }, { onSuccess: restore, onError: fail });
    }
  };

  const handleAnswer = (attribute: ClaimAttribute, answer: DeckAnswer) => {
    if (answer === "skip") {
      // Skip leaves any existing vote untouched — keep it visible in the
      // summary rather than pretending the card is now un-attested.
      setAnswers((prev) => ({
        ...prev,
        [attribute]: votes[attribute] ?? "skip",
      }));
      return;
    }
    const previous = votes[attribute];
    setAnswers((prev) => ({ ...prev, [attribute]: answer }));
    setVotes((prev) => ({ ...prev, [attribute]: answer }));
    vote.mutate(
      { attribute, value: answer },
      {
        onSuccess: () => {
          toast.success("Vote recorded", {
            action: { label: "Undo", onClick: () => undo(attribute, previous) },
          });
        },
        onError: () => {
          // Roll the local snapshot back so the summary never shows a vote
          // the server rejected.
          setAnswers((prev) => ({ ...prev, [attribute]: previous ?? undefined }));
          setVotes((prev) => ({ ...prev, [attribute]: previous }));
          toast.error("Could not record your vote. Please try again.");
        },
      }
    );
  };

  const caption = (attribute: ClaimAttribute): string | null => {
    const standing = votes[attribute];
    if (standing === null) {
      return null;
    }
    if (attribute === "celiac_safe_vs_gluten_friendly") {
      return standing === "confirm"
        ? "You marked this celiac-safe."
        : "You marked this gluten-friendly.";
    }
    return standing === "confirm" ? "You confirmed this." : "You disputed this.";
  };

  return (
    <div className="mb-4 flex flex-col">
      <Button type="button" onClick={openDeck} className="min-h-11 w-full sm:w-auto sm:self-start">
        Been here? Confirm what you know
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          // Bottom sheet on mobile; a centered, card-radius dialog from `sm:`
          // up (composing the one Sheet primitive instead of a second drawer).
          className="max-h-[90dvh] overflow-y-auto rounded-t-card sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:border"
        >
          <SheetHeader className="pb-0">
            <SheetTitle>Confirm what you know</SheetTitle>
            <SheetDescription>
              Swipe right to confirm, left to dispute — or use the buttons. Your answers save
              immediately.
            </SheetDescription>
          </SheetHeader>
          <div className="p-4 pt-0">
            <ClaimCardDeck
              answers={answers}
              onAnswer={handleAnswer}
              showSummary
              onDone={() => setOpen(false)}
              cardCaption={caption}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function emptyVotes(): Record<ClaimAttribute, AttestationValue | null> {
  return {
    celiac_safe_vs_gluten_friendly: null,
    dedicated_fryer: null,
    dedicated_gf_menu: null,
    off_menu_gf_on_request: null,
    gf_substitutes: null,
  };
}
