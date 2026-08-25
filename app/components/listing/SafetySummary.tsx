import { SAFETY_TOOLTIP, SafetySignal, type SafetyState } from "~/components/SafetySignal";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

interface SafetySummaryProps {
  /**
   * The derived headline trust state. When there is no verdict to show — no
   * evidence, or disputes tie/outnumber confirms — pass `undefined`/`null` and
   * the component renders honest guidance instead of a fabricated rating.
   */
  state?: SafetyState | null;
  /**
   * Visual emphasis. `"default"` is the standalone section; `"hero"` places the cue
   * in the listing hero's solid bar, where it reads as the page's headline verdict.
   * The headline renders at the shared badge-family size, identical to the per-claim
   * badges — it stays the primary verdict by its solid fill + hero position, not by
   * size. Both variants keep the accessible region + heading and the honest empty
   * state; only the fill/position and heading visibility differ.
   */
  variant?: "default" | "hero";
  /**
   * Whether a recent "got glutened" report is on file (see `findRecentIncident` in
   * `~/trust/incident-recency.ts`). Independent of `state` — a listing can have a
   * fresh celiac-safe consensus and a recent incident at once, so both badges render
   * side by side.
   *
   * Rendered only in the `"hero"` variant: this component owns the whole hero badge
   * row — headline badge (when there is one) plus incident badge, each exactly once.
   * Ignored in `"default"`, which stays a single headline verdict.
   */
  hasRecentIncident?: boolean;
}

/**
 * Plain-language guidance for the no-verdict state — one constant so every
 * render reads the same. Covers an unattested claim and a disputed one alike:
 * the two are indistinguishable by design (owner decision 2026-08-25).
 */
const NO_CONFIRMATION_GUIDANCE =
  "No one has confirmed this restaurant is celiac-safe yet. " +
  "Verify cross-contamination practices with the restaurant directly.";

/**
 * The headline celiac-safe signal for a listing — and, in the `"hero"` variant,
 * the whole safety-badge row for the detail page's hero card, so every applicable
 * badge renders exactly once.
 *
 * The most important cue on the page (docs/agents/domain.md). Accessible by
 * construction: the populated case delegates to {@link SafetySignal} (colour + icon
 * + text label), and the no-verdict case is plain prose, so meaning never depends
 * on colour or styling. In the hero, each badge carries a supplementary tooltip
 * ({@link SAFETY_TOOLTIP}) on a keyboard-focusable trigger. The `"default"` variant
 * stays the bare chip — no tooltip wrapper.
 *
 * Never invent a safety rating — an old or fabricated consensus could put a celiac
 * at real risk. A `null` state therefore renders NO badge of any kind, only the
 * guidance sentence: an unattested listing and a disputed one must not be
 * distinguishable.
 *
 * Hero row layout: badges sit in one row that scrolls horizontally on overflow
 * instead of wrapping (`overflow-x-auto`, hidden scrollbar, `shrink-0` chips — the
 * `FilterChips` pattern), so the row never pushes the page wider at the 375px
 * minimum width. Compensating `-m-1`/`p-1` keeps each trigger's focus-visible ring
 * inside the scroll area instead of clipped. The row is exposed to assistive tech
 * as a "Safety status" group (chrome-reset `<fieldset>` + sr-only `<legend>`),
 * distinct from the section's "Gluten-free safety" region name; the section heading
 * is visually hidden in `"hero"` so the accessible region name stays stable across
 * variants.
 */
export function SafetySummary({
  state,
  variant = "default",
  hasRecentIncident = false,
}: SafetySummaryProps) {
  const isHero = variant === "hero";

  // A native `<button>` trigger makes each tooltip keyboard-reachable (Tab +
  // focus) without an a11y-smell tabIndex on a non-interactive element, while
  // the chip inside keeps its colour + icon + label contract.
  const tooltipButtonClassName =
    "inline-flex shrink-0 rounded-chip cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring";

  const headlineBadge = state ? (
    isHero ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className={tooltipButtonClassName}>
            {/* No size override: the headline renders at the shared badge-family
                size and stays the primary verdict by its solid fill + hero
                position, never by being bigger. */}
            <SafetySignal state={state} variant="solid" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{SAFETY_TOOLTIP[state]}</TooltipContent>
      </Tooltip>
    ) : (
      // Same shared size as everywhere else; `self-start` is alignment, not size.
      <SafetySignal state={state} variant="solid" className="self-start" />
    )
  ) : null;

  // No verdict: prose, never a chip. A dashed "Not yet attested" badge would
  // still be a safety indicator, and a disputed claim has to look exactly like
  // an unattested one. Rendered below the badge row so a recent incident keeps
  // the row's leading position and stays visible at 375px (ADR-007).
  const guidance = state ? null : (
    <p
      data-testid="safety-summary-guidance"
      className={`max-w-prose text-body-sm text-muted-foreground${isHero ? " mt-2" : ""}`}
    >
      {NO_CONFIRMATION_GUIDANCE}
    </p>
  );

  const incidentBadge =
    isHero && hasRecentIncident ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className={tooltipButtonClassName}>
            <SafetySignal state="incident" variant="soft" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{SAFETY_TOOLTIP.incident}</TooltipContent>
      </Tooltip>
    ) : null;

  return (
    <section
      aria-labelledby="safety-summary-heading"
      className={isHero ? "flex min-w-0 flex-col" : "flex flex-col gap-3"}
    >
      <h2
        id="safety-summary-heading"
        className={
          isHero
            ? "sr-only"
            : "text-caption font-semibold uppercase tracking-wide text-muted-foreground"
        }
      >
        Gluten-free safety
      </h2>

      {isHero
        ? // Chrome-reset <fieldset> + sr-only <legend> (what Biome's
          // useSemanticElements prefers over role="group") gives the badge row an
          // exposed group role + accessible name — an aria-label on a generic div is
          // ignored by most AT. `min-w-0` overrides the <fieldset> UA-stylesheet auto
          // min-width so the row can shrink and hand overflow to `overflow-x-auto`
          // instead of forcing the hero wider at 375px. The `p-1` (compensated by
          // `-m-1`) keeps each trigger's focus-visible ring inside the scroll
          // container — without it, `overflow-x-auto` clips the ring's box-shadow.
          // Skipped entirely when there is no badge to group: an empty labelled
          // group announces a "Safety status" that holds nothing.
          (headlineBadge || incidentBadge) && (
            <fieldset className="-m-1 flex min-w-0 items-center gap-2 overflow-x-auto border-0 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <legend className="sr-only">Safety status</legend>
              {headlineBadge}
              {incidentBadge}
            </fieldset>
          )
        : headlineBadge}
      {guidance}
    </section>
  );
}
