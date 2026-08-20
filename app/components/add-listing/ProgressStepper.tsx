import { Check } from "lucide-react";
import { cn } from "~/lib/utils";
import { CLAIM_ATTRIBUTES } from "~/listings/taxonomy";
import type { AnswerMap } from "./AddListingWizard";

/**
 * The 3-node progress rail for the add-listing wizard: find-the-place → one
 * attest stage (the deck keeps its own internal "n of 5" indicator) → review.
 * Each node is a button for back-navigation; forward jumps are gated until a
 * place is chosen (there is nothing to attest before then). Status is derived
 * — never alarming:
 *
 *   current  — brand-filled (the stage you're on)
 *   done     — celiac-safe green + check (a chosen place, or every attribute
 *              answered with confirm/dispute)
 *   skipped  — muted dashed (every attribute answered but at least one skip —
 *              a valid, honest choice, not incident-red)
 *   todo     — neutral border + number (any attribute still unanswered)
 *
 * An `aria-live="polite"` line announces "Step N of 3 · <name>" as the stage
 * changes, so the position is conveyed without relying on the colour rail.
 */

export const WIZARD_STEP_COUNT = 3;

export type StepStatus = "current" | "done" | "skipped" | "todo";

export interface StepperNode {
  label: string;
  status: StepStatus;
}

/** Node labels, in order: find-the-place, the deck stage, review. */
const STEP_LABELS: readonly string[] = ["Find the place", "Attest what you know", "Review"];

/**
 * Pure status derivation for the rail — the single, testable specification of
 * which node reads current / done / skipped / todo, given the wizard's position,
 * whether a place is chosen, and the answers so far.
 */
export function deriveStepperNodes(
  step: number,
  hasPlace: boolean,
  answers: AnswerMap
): StepperNode[] {
  return STEP_LABELS.map((label, index) => ({
    label,
    status: nodeStatus(index, step, hasPlace, answers),
  }));
}

function nodeStatus(
  index: number,
  step: number,
  hasPlace: boolean,
  answers: AnswerMap
): StepStatus {
  if (index === step) {
    return "current";
  }
  // Find-the-place node: "done" once a place is collected.
  if (index === 0) {
    return hasPlace ? "done" : "todo";
  }
  // The single attest node rolls the whole deck up: done when every attribute
  // is confirm/dispute; dashed "skipped" when every card was answered but at
  // least one was an honest skip; todo while any card is still unanswered.
  if (index === 1) {
    const values = CLAIM_ATTRIBUTES.map((attribute) => answers[attribute]);
    if (values.some((answer) => answer === undefined)) {
      return "todo";
    }
    return values.every((answer) => answer === "confirm" || answer === "dispute")
      ? "done"
      : "skipped";
  }
  // Review node.
  return "todo";
}

const STATUS_CLASS: Record<StepStatus, string> = {
  current: "border-brand bg-brand text-brand-foreground",
  done: "border-celiac-safe bg-celiac-safe-soft text-celiac-safe",
  skipped: "border-dashed border-muted-foreground/60 text-muted-foreground",
  todo: "border-border text-muted-foreground",
};

const STATUS_WORD: Record<StepStatus, string> = {
  current: "current step",
  done: "answered",
  skipped: "skipped",
  todo: "not started",
};

export function ProgressStepper({
  step,
  hasPlace,
  answers,
  onNavigate,
}: {
  step: number;
  hasPlace: boolean;
  answers: AnswerMap;
  onNavigate: (step: number) => void;
}) {
  const nodes = deriveStepperNodes(step, hasPlace, answers);

  return (
    <nav aria-label="Add listing progress" className="flex flex-col gap-2">
      <ol className="flex items-center gap-1">
        {nodes.map((node, index) => {
          // Back-nav is always allowed; forward is gated until a place exists.
          const navigable = index <= step || hasPlace;
          return (
            <li key={node.label} className="flex min-w-0 flex-1 justify-center">
              <button
                type="button"
                onClick={() => onNavigate(index)}
                disabled={!navigable}
                aria-current={node.status === "current" ? "step" : undefined}
                aria-label={`Step ${index + 1}: ${node.label} (${STATUS_WORD[node.status]})`}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full border text-body-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  STATUS_CLASS[node.status],
                  navigable ? "cursor-pointer" : "cursor-not-allowed opacity-60"
                )}
              >
                {node.status === "done" ? (
                  <Check aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.5} />
                ) : (
                  <span aria-hidden="true">{index + 1}</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className="text-body-sm font-medium text-muted-foreground">
        Step {step + 1} of {WIZARD_STEP_COUNT} · {nodes[step]?.label}
      </p>
    </nav>
  );
}
