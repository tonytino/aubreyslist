import { cn } from "~/lib/utils";
import { CLAIM_ATTRIBUTES } from "~/listings/taxonomy";
import type { DeckAnswerMap } from "./ClaimCardDeck";

/**
 * The deck's lightweight "n of 5" indicator (AUB-231). The TEXT counter carries
 * the meaning (never dots alone — spec §6); the dot rail is decorative
 * (`aria-hidden`) and mirrors the ProgressStepper's status language:
 *
 *   current  — brand-filled
 *   answered — celiac-safe soft (a confirm/dispute answer)
 *   skipped  — dashed muted (an honest, non-alarming skip)
 *   todo     — neutral border
 */
export function DeckProgress({ index, answers }: { index: number; answers: DeckAnswerMap }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-body-sm font-medium text-muted-foreground">
        Card {index + 1} of {CLAIM_ATTRIBUTES.length}
      </p>
      <ol aria-hidden="true" className="flex items-center gap-1.5">
        {CLAIM_ATTRIBUTES.map((attribute, dotIndex) => {
          const answer = answers[attribute];
          const status =
            dotIndex === index
              ? "current"
              : answer === "confirm" || answer === "dispute"
                ? "answered"
                : answer === "skip"
                  ? "skipped"
                  : "todo";
          return (
            <li
              key={attribute}
              className={cn(
                "size-2.5 rounded-full border",
                status === "current" && "border-brand bg-brand",
                status === "answered" && "border-celiac-safe bg-celiac-safe-soft",
                status === "skipped" && "border-dashed border-muted-foreground/60",
                status === "todo" && "border-border"
              )}
            />
          );
        })}
      </ol>
    </div>
  );
}
