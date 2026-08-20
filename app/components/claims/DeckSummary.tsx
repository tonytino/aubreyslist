import { Pencil } from "lucide-react";
import { ReviewOutcome } from "~/components/add-listing/ReviewStep";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { CLAIM_ATTRIBUTES, type ClaimAttribute } from "~/listings/taxonomy";
import { claimAttributeLabel } from "~/trust/summary";
import type { DeckAnswerMap } from "./ClaimCardDeck";

/**
 * The deck's end-state summary (AUB-231, spec §6 "End state") — used by the
 * listing-detail host only (the add-listing wizard hands off to its existing
 * ReviewStep instead, so there is never a double summary).
 *
 * Each row renders through the SAME {@link ReviewOutcome} the wizard's review
 * step uses — headline confirm/dispute → `SafetySignal` chip, fact
 * confirm/dispute → `FactOutcomeChip`, skip/untouched → the dashed "Not yet
 * attested" pill — so the two summaries are one implementation and cannot
 * drift (AUB-227). Per-row Edit jumps back to that card; Done closes.
 */
export function DeckSummary({
  answers,
  onEdit,
  onDone,
  className,
}: {
  answers: DeckAnswerMap;
  onEdit: (attribute: ClaimAttribute) => void;
  onDone?: (() => void) | undefined;
  className?: string;
}) {
  return (
    <section aria-label="Your answers" className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-1.5">
        <h3 className="font-display text-title font-semibold text-foreground">Your answers</h3>
        <p className="text-body-sm text-muted-foreground">
          Skipped attributes stay &ldquo;Not yet attested&rdquo; and record nothing — an honest gap
          beats a guess.
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-card px-card text-card-foreground">
        {CLAIM_ATTRIBUTES.map((attribute) => (
          <li key={attribute} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <span className="min-w-0 flex-1 text-body font-medium text-foreground">
              {claimAttributeLabel(attribute)}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <ReviewOutcome attribute={attribute} answer={answers[attribute]} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onEdit(attribute)}
                aria-label={`Edit ${claimAttributeLabel(attribute)}`}
                className="gap-1.5"
              >
                <Pencil aria-hidden="true" className="size-4 shrink-0" />
                Edit
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {onDone ? (
        <Button type="button" onClick={onDone} className="min-h-11 w-full">
          Done
        </Button>
      ) : null}
    </section>
  );
}
