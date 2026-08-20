import { useRef, useState } from "react";
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
 * The listing-detail host for the {@link ClaimCardDeck}: a "Been here? Confirm what
 * you know" CTA at the top of the Claims tab that opens the deck in a bottom sheet
 * on mobile / a centered dialog on ≥sm.
 *
 * Semantics:
 *   - Signed-in only: anonymous viewers see nothing here — the tab's sign-in copy
 *     and per-row prompts remain the sign-in path.
 *   - Pre-seeded: on open, each card seeds from the viewer's current vote, with a
 *     "You marked this …" caption on pre-voted cards. The snapshot is taken once
 *     per open so mid-flow refetches never reshuffle the deck.
 *   - Immediate writes: confirm/dispute writes through the same
 *     {@link useClaimVoteMutations} seam the inline `ClaimVoteControls` use, so
 *     counts, trust rows, and the hero badges refresh live.
 *   - Skip is safe: "Not sure" on an already-voted card leaves the existing vote
 *     untouched (retract stays available via the inline toggles).
 *   - Mis-swipe undo: every write surfaces an inline "Vote recorded · Undo" row
 *     inside the sheet. Deliberately not a sonner toast: the sheet is a modal Radix
 *     dialog (body pointer-events disabled + focus trapped), so a toast's action
 *     would be unreachable while it is open. The row targets only the latest
 *     write — a newer write replaces it — and a write-id guard backstops staleness.
 *
 * The sheet never dismisses on horizontal drag (Radix has no drag-to-dismiss; the
 * deck keeps ~24px edge dead zones for the OS back gesture).
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
  // The latest write's undo target — the inline "Vote recorded · Undo" row.
  // Each new write replaces it (one live undo at a time), and `id` against the
  // monotonic counter guards any stale callback from clobbering a newer vote.
  const [lastWrite, setLastWrite] = useState<{
    id: number;
    attribute: ClaimAttribute;
    previous: AttestationValue | null;
  } | null>(null);
  const writeIdRef = useRef(0);
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

  /**
   * Roll the latest write back to its pre-write state (the inline Undo). The
   * write-id check no-ops any stale invocation — only the newest write is undoable,
   * so an older Undo can never blind-retract a newer vote.
   */
  const undoLastWrite = () => {
    if (lastWrite === null || lastWrite.id !== writeIdRef.current) {
      return;
    }
    const { attribute, previous } = lastWrite;
    setLastWrite(null);
    const restore = () => {
      setVotes((prev) => ({ ...prev, [attribute]: previous }));
      setAnswers((prev) => ({ ...prev, [attribute]: previous ?? undefined }));
      // Passive confirmation only (no action) — fine from inside the modal.
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
    const id = ++writeIdRef.current;
    setAnswers((prev) => ({ ...prev, [attribute]: answer }));
    setVotes((prev) => ({ ...prev, [attribute]: answer }));
    // Offer the undo immediately (optimistic, like the answer itself); a
    // failed write clears it again alongside the rollback below.
    setLastWrite({ id, attribute, previous });
    vote.mutate(
      { attribute, value: answer },
      {
        onError: () => {
          // Roll the local snapshot back so the summary never shows a vote
          // the server rejected, and retire this write's undo affordance.
          setAnswers((prev) => ({ ...prev, [attribute]: previous ?? undefined }));
          setVotes((prev) => ({ ...prev, [attribute]: previous }));
          setLastWrite((current) => (current?.id === id ? null : current));
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

      <Sheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            // The undo affordance lives inside the sheet — retire it on close.
            setLastWrite(null);
          }
        }}
      >
        <SheetContent
          side="bottom"
          // Bottom sheet on mobile; a centered, card-radius dialog from `sm:`
          // up (composing the one Sheet primitive instead of a second drawer).
          // At `sm:` the bottom-sheet slide keyframes are zeroed out in favour
          // of a dialog-like fade + zoom (matching ui/dialog.tsx), so the
          // centered panel never sweeps up from the viewport bottom.
          className="max-h-[90dvh] overflow-y-auto rounded-t-card sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:border sm:data-[state=closed]:duration-200 sm:data-[state=closed]:fade-out-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:duration-200 sm:data-[state=open]:fade-in-0 sm:data-[state=open]:zoom-in-95 sm:data-[state=open]:slide-in-from-bottom-0"
        >
          <SheetHeader className="pb-0">
            <SheetTitle>Confirm what you know</SheetTitle>
            <SheetDescription>
              Swipe right to confirm, left to dispute — or use the buttons. Your answers save
              immediately.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 p-4 pt-0">
            <ClaimCardDeck
              answers={answers}
              onAnswer={handleAnswer}
              showSummary
              onDone={() => setOpen(false)}
              cardCaption={caption}
            />
            {/* Inline mis-swipe recovery: the sheet is modal, so a toast action would
                sit outside the focus trap and behind Radix's body pointer-events
                lock — this row is inside both. It reflects only the latest write. */}
            {lastWrite !== null ? (
              <div
                role="status"
                className="flex items-center justify-between gap-2 rounded-card border border-border bg-muted/40 py-1.5 pr-1.5 pl-3"
              >
                <span className="text-body-sm text-muted-foreground">Vote recorded</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={undoLastWrite}
                  className="min-h-11"
                >
                  Undo
                </Button>
              </div>
            ) : null}
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
