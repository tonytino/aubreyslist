import { SAFETY_STATES, SafetySignal, type SafetyState } from "~/components/SafetySignal";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

/**
 * Supplementary one-line gloss per safety state, surfaced as a tooltip on each
 * legend chip. The chip already carries colour + icon + text label (the meaning);
 * the tooltip only ADDS context and is never the sole carrier of meaning
 * (docs/agents/styling.md, NON-NEGOTIABLE).
 */
const LEGEND_TOOLTIPS: Record<SafetyState, string> = {
  "celiac-safe": "Community-vouched celiac-safe — takes cross-contamination seriously.",
  "gluten-friendly": "Offers gluten-free options but is not verified celiac-safe.",
  stale: "Not confirmed within the staleness window — the info may be out of date.",
  incident: "A recent glutened report is on file for this listing.",
};

/**
 * The safety-signal legend row (AUB-131): a light, wrapping row of all four
 * {@link SafetySignal} states in their `soft` variant, shown directly below the
 * recent-incident banner on the listing detail page.
 *
 * There is deliberately NO heading or boxed section — it reads as a quiet
 * key/legend, not a titled panel (the old boxed "Gluten-free safety" section is
 * gone). Each chip keeps the full colour + icon + text-label contract; a
 * supplementary tooltip adds a one-line gloss for anyone who wants it.
 *
 * Presentational + prop-free: driven entirely by the exported `SAFETY_STATES`
 * enumeration so it can never drift from the canonical set of signals.
 */
export function SafetyLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="What the safety signals mean">
      {SAFETY_STATES.map((state) => (
        <Tooltip key={state}>
          <TooltipTrigger asChild>
            {/* A native button makes the tooltip keyboard-reachable (Tab + focus)
                without an a11y-smell tabIndex on a non-interactive element, while
                the chip inside keeps its colour + icon + label. */}
            <button
              type="button"
              className="inline-flex rounded-chip cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            >
              <SafetySignal state={state} variant="soft" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{LEGEND_TOOLTIPS[state]}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
