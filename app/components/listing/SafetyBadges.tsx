import { SAFETY_TOOLTIP, SafetySignal, type SafetyState } from "~/components/SafetySignal";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

interface SafetyBadgesProps {
  /**
   * The derived headline celiac-safe / gluten-friendly / stale state (see
   * `deriveHeadlineSafetyState` in `~/trust/summary.ts`), or `null` when the
   * listing has no `celiac_safe_vs_gluten_friendly` attestation evidence yet.
   * The three non-null values are mutually exclusive by construction — at most
   * one headline badge ever renders.
   */
  state: SafetyState | null;
  /**
   * Whether a recent "got glutened" report is on file for this listing (see
   * `findRecentIncident` in `~/trust/incident-recency.ts`). Independent of
   * `state` — a listing can have a fresh celiac-safe consensus AND a recent
   * incident at the same time, so both badges can render together.
   */
  hasRecentIncident: boolean;
}

/**
 * The safety-signal status row (AUB-131 owner feedback): renders a badge ONLY
 * for the signals that actually APPLY to this listing — never the full set of
 * four `SafetySignal` states regardless of relevance.
 *
 * Previously `SafetyLegend`, a prop-free component that always rendered all
 * four states as a "key". The repo owner reads these as status badges, not a
 * legend, so a listing with no incident and a celiac-safe consensus should
 * show ONLY the celiac-safe badge — showing "Needs update" or "Recent
 * incident" alongside it read as false/contradictory status.
 *
 * Renders:
 * - the headline `state` badge, when non-null (celiac-safe OR gluten-friendly
 *   OR stale — never more than one, they're mutually exclusive);
 * - the incident badge, when `hasRecentIncident` is true;
 * - nothing at all (returns `null`, no empty gap) when neither applies, e.g. an
 *   unattested listing with no incidents.
 *
 * There is deliberately NO heading or boxed section — same quiet, unboxed
 * treatment as the row it replaces (the wrapper is a chrome-reset `<fieldset>`
 * with an sr-only `<legend>`, so assistive tech exposes a "Safety status" group
 * name without a visible heading). Each badge
 * keeps the full colour + icon + text-label contract; a supplementary tooltip
 * adds the canonical one-line gloss from the shared {@link SAFETY_TOOLTIP} copy
 * (single source of tooltip wording across the About legend, style guide, and
 * status chips — never a per-surface fork).
 *
 * NOTE: the headline badge here partially duplicates the hero `SafetySummary`
 * shown above it on the listing detail page. That overlap is intentional/
 * accepted — it mirrors the same at-a-glance badge pattern the browse card
 * uses — not a bug to fix in this pass.
 */
export function SafetyBadges({ state, hasRecentIncident }: SafetyBadgesProps) {
  if (state === null && !hasRecentIncident) {
    return null;
  }

  return (
    // A <fieldset> + sr-only <legend> (the repo's ViewToggle pattern, and what
    // Biome's useSemanticElements rule prefers over role="group") gives the row
    // an exposed group role + accessible name — an aria-label on a role-less
    // (generic) div is ignored by most AT. Default fieldset chrome is reset.
    <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0">
      <legend className="sr-only">Safety status</legend>
      {state ? (
        <Tooltip>
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
          <TooltipContent>{SAFETY_TOOLTIP[state]}</TooltipContent>
        </Tooltip>
      ) : null}
      {hasRecentIncident ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex rounded-chip cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            >
              <SafetySignal state="incident" variant="soft" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{SAFETY_TOOLTIP.incident}</TooltipContent>
        </Tooltip>
      ) : null}
    </fieldset>
  );
}
