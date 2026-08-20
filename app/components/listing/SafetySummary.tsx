import { SAFETY_TOOLTIP, SafetySignal, type SafetyState } from "~/components/SafetySignal";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

interface SafetySummaryProps {
  /**
   * The derived headline trust state. When trust data does not exist, pass
   * `undefined`/`null` and the component renders an honest "Not yet attested" empty
   * state instead of a fabricated rating.
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
   * row — headline badge (or honest empty state) plus incident badge, each exactly
   * once. Ignored in `"default"`, which stays a single headline verdict.
   */
  hasRecentIncident?: boolean;
}

/**
 * Plain-language guidance for the honest "Not yet attested" empty state — one
 * constant so the full-box and compact renders can never drift apart in wording.
 */
const NOT_YET_ATTESTED_GUIDANCE =
  "No one has confirmed yet whether this restaurant is celiac-safe or only gluten-friendly. " +
  "Verify cross-contamination practices with the restaurant directly.";

/**
 * The headline celiac-safe vs. gluten-friendly signal for a listing — and, in the
 * `"hero"` variant, the whole safety-badge row for the detail page's hero card, so
 * every applicable badge renders exactly once.
 *
 * The most important cue on the page (docs/agents/domain.md). Accessible by
 * construction: the populated case delegates to {@link SafetySignal} (colour + icon
 * + text label), and the empty case states "Not yet attested" in plain text, so
 * meaning never depends on colour or styling. In the hero, each badge carries a
 * supplementary tooltip ({@link SAFETY_TOOLTIP}) on a keyboard-focusable trigger.
 * The `"default"` variant stays the bare chip — no tooltip wrapper.
 *
 * Never invent a safety rating — an old or fabricated consensus could put a celiac
 * at real risk.
 *
 * Hero row layout: badges sit in one row that scrolls horizontally on overflow
 * instead of wrapping (`overflow-x-auto`, hidden scrollbar, `shrink-0` chips — the
 * `FilterChips` pattern), so the row never pushes the page wider at the 375px
 * minimum width. Compensating `-m-1`/`p-1` keeps each trigger's focus-visible ring
 * inside the scroll area instead of clipped. When the row holds both the empty
 * state and the incident badge, the empty state compacts to a dashed chip (guidance
 * moves into its tooltip) so recent harm stays visible, never buried (ADR-007). The
 * row is exposed to assistive tech as a "Safety status" group (chrome-reset
 * `<fieldset>` + sr-only `<legend>`), distinct from the section's "Gluten-free
 * safety" region name; the section heading is visually hidden in `"hero"` so the
 * accessible region name stays stable across variants.
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
  ) : isHero && hasRecentIncident ? (
    // Compact empty state, only when it must share the never-wrapping hero row with
    // the incident badge: the full box would push the incident chip off-screen at
    // 375px, and recent harm must stay visible (ADR-007). The "Not yet attested"
    // label stays visible; the guidance sentence moves into the chip's tooltip
    // (keyboard-reachable, announced on focus via aria-describedby).
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={tooltipButtonClassName}>
          <span className="inline-flex items-center rounded-chip border border-dashed border-border bg-muted px-2.5 py-1 text-body-sm font-medium text-foreground">
            Not yet attested
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{NOT_YET_ATTESTED_GUIDANCE}</TooltipContent>
    </Tooltip>
  ) : (
    // Full empty-state box: the default variant, and the hero without an incident.
    // In the hero's overflow row the box is `shrink-0`, so it needs a width cap —
    // without one a flex item's base size is its max-content width (the guidance
    // sentence unwrapped) and the row would scroll for no reason at 375px. `w-full`
    // before the max-w cap resolves the box to the row's content width first, while
    // `max-w-xs`/`sm:` still cap it on wider rows.
    <div
      className={`flex shrink-0 flex-col gap-1 rounded-card border border-dashed border-border bg-muted p-gutter${
        isHero ? " w-full max-w-xs sm:max-w-sm" : ""
      }`}
    >
      <p className="text-body font-semibold text-foreground">Not yet attested</p>
      <p className="text-body-sm text-muted-foreground">{NOT_YET_ATTESTED_GUIDANCE}</p>
    </div>
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

      {isHero ? (
        // Chrome-reset <fieldset> + sr-only <legend> (what Biome's
        // useSemanticElements prefers over role="group") gives the badge row an
        // exposed group role + accessible name — an aria-label on a generic div is
        // ignored by most AT. `min-w-0` overrides the <fieldset> UA-stylesheet auto
        // min-width so the row can shrink and hand overflow to `overflow-x-auto`
        // instead of forcing the hero wider at 375px. The `p-1` (compensated by
        // `-m-1`) keeps each trigger's focus-visible ring inside the scroll
        // container — without it, `overflow-x-auto` clips the ring's box-shadow.
        <fieldset className="-m-1 flex min-w-0 items-center gap-2 overflow-x-auto border-0 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <legend className="sr-only">Safety status</legend>
          {headlineBadge}
          {incidentBadge}
        </fieldset>
      ) : (
        headlineBadge
      )}
    </section>
  );
}
