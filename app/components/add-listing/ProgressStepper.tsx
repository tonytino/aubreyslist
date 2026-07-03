import { Check } from "lucide-react";
import { cn } from "~/lib/utils";
import { CLAIM_ATTRIBUTES } from "~/listings/taxonomy";
import { claimAttributeLabel } from "~/trust/summary";
import type { AnswerMap } from "./AddListingWizard";

/**
 * The 7-node progress rail for the add-listing wizard. Each node is a button for
 * back-navigation; forward jumps are gated until a place is chosen (there is
 * nothing to attest before then). Status is derived — never alarming:
 *
 *   current  — brand-filled (the step you're on)
 *   done     — celiac-safe green + check (a confirm/dispute answer, or a chosen place)
 *   skipped  — muted DASHED (non-alarming — a skip is a valid, honest choice, NOT incident-red)
 *   todo     — neutral border + number
 *
 * An `aria-live="polite"` line announces "Step N of 7 · <name>" as the step
 * changes, so the position is conveyed without relying on the colour rail.
 */

export const WIZARD_STEP_COUNT = 7;

export type StepStatus = "current" | "done" | "skipped" | "todo";

export interface StepperNode {
  label: string;
  status: StepStatus;
}

/** Node labels, in order: find-the-place, the five attributes, review. */
const STEP_LABELS: readonly string[] = [
  "Find the place",
  ...CLAIM_ATTRIBUTES.map((attribute) => claimAttributeLabel(attribute)),
  "Review",
];

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
  // Attribute nodes (1..N): reflect the confirm/dispute/skip answer.
  const attribute = CLAIM_ATTRIBUTES[index - 1];
  if (index >= 1 && index <= CLAIM_ATTRIBUTES.length && attribute !== undefined) {
    const answer = answers[attribute];
    if (answer === "confirm" || answer === "dispute") {
      return "done";
    }
    if (answer === "skip") {
      return "skipped";
    }
    return "todo";
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
