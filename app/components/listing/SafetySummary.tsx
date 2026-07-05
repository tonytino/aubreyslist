import { SAFETY_TOOLTIP, SafetySignal, type SafetyState } from "~/components/SafetySignal";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

interface SafetySummaryProps {
  /**
   * The derived headline trust state, once EPIC 4 (#28/#29) computes it from
   * attestation data. While trust data does not exist, leave this `undefined`
   * (or `null`) and the component renders an honest "Not yet attested" empty
   * state instead of a fabricated rating.
   */
  state?: SafetyState | null;
  /**
   * Visual emphasis. `"default"` is the standalone section; `"hero"` (AUB-131)
   * scales the cue up to sit in the listing hero's solid bar below the media,
   * where it reads as the page's headline verdict. Both variants keep the
   * accessible region + heading and the honest empty state — only sizing and the
   * heading's visibility differ.
   */
  variant?: "default" | "hero";
  /**
   * Whether a recent "got glutened" report is on file for this listing (see
   * `findRecentIncident` in `~/trust/incident-recency.ts`). Independent of
   * `state` — a listing can have a fresh celiac-safe consensus AND a recent
   * incident at the same time, so both badges render side by side.
   *
   * Only rendered in the `"hero"` variant — repo-owner feedback was that the
   * detail page showed the headline safety state TWICE (once here, once in a
   * standalone `SafetyBadges` row below the hero). This component now owns the
   * WHOLE badge row for the hero card — the headline badge (or the honest empty
   * state) plus the incident badge, exactly once, together. Ignored in the
   * `"default"` variant, which stays a single headline verdict.
   */
  hasRecentIncident?: boolean;
}

/**
 * The plain-language guidance for the honest "Not yet attested" empty state —
 * a single constant so the full-box and compact (hero + incident) renders of
 * the empty state can never drift apart in wording.
 */
const NOT_YET_ATTESTED_GUIDANCE =
  "No one has confirmed yet whether this restaurant is celiac-safe or only gluten-friendly. " +
  "Verify cross-contamination practices with the restaurant directly.";

/**
 * The prominent, headline celiac-safe vs. gluten-friendly signal for a listing —
 * and, in the `"hero"` variant, the WHOLE safety-badge row for the listing detail
 * page's hero card (repo-owner feedback, nits-detail-badges-once): previously a
 * separate `SafetyBadges` row duplicated this same headline state below the
 * hero. That standalone component is retired; its incident-badge + tooltip +
 * "Safety status" labelled-group behaviour now lives here, folded into the hero
 * presentation, so every applicable badge renders exactly once.
 *
 * This is the most important cue on the page (docs/agents/domain.md → "surface
 * this most prominently"). It is accessible by construction: the populated case
 * delegates to {@link SafetySignal}, which always pairs COLOUR + ICON + TEXT
 * LABEL, and the empty case states "Not yet attested" in plain text so the
 * meaning never depends on colour or styling. In the hero, each badge also
 * carries a supplementary tooltip (the shared {@link SAFETY_TOOLTIP} copy) on a
 * keyboard-focusable trigger, so the extra gloss is reachable without a
 * pointer. The `"default"` variant stays the bare chip — no tooltip wrapper —
 * exactly as before the hero row absorbed the badges.
 *
 * IMPORTANT: we deliberately do NOT invent a safety rating — an old or fabricated
 * consensus could put a celiac at real risk. The `state` prop is the single seam
 * EPIC 4 wires up; everything else here already handles the populated render.
 *
 * The `"hero"` variant (AUB-131) renders the SAME headline cue at hero scale
 * inside the listing hero's solid bar, plus the incident badge when
 * `hasRecentIncident` is true. Both badges (or the badge + the honest empty
 * state) sit in ONE row that scrolls horizontally on overflow instead of
 * wrapping — `overflow-x-auto` with a hidden scrollbar and `shrink-0` chips
 * (the same pattern as the directory's `FilterChips` row) — so the row never
 * pushes the page wider at the 375px minimum width. The scroll container
 * carries compensating `-m-1`/`p-1` so each trigger's `focus-visible` ring
 * draws INSIDE the scrollable area instead of being clipped by `overflow-x-auto`
 * (FilterChips solves the same clipping with its `-mx-gutter`/`px-gutter`
 * bleed). When the row must hold BOTH the empty state and the incident badge,
 * the empty state compacts to a dashed "Not yet attested" chip (its guidance
 * sentence moves into the chip's tooltip) so the incident badge is never pushed
 * off-screen at 375px — recent harm stays visible, never buried (ADR-007). The
 * row is exposed to assistive tech as a labelled "Safety status" group (a
 * chrome-reset `<fieldset>` + sr-only `<legend>`, the repo's `ViewToggle`
 * pattern), distinct from this section's own "Gluten-free safety" region name.
 * The `aria-labelledby` section + its heading are kept in both variants (the
 * heading is visually hidden in `"hero"` since the hero band already reads as
 * the headline), so the accessible "Gluten-free safety" region name is stable
 * across the redesign.
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
            <SafetySignal state={state} variant="solid" className="text-lead gap-2 px-4 py-2" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{SAFETY_TOOLTIP[state]}</TooltipContent>
      </Tooltip>
    ) : (
      <SafetySignal state={state} variant="solid" className="text-body self-start px-3 py-1.5" />
    )
  ) : isHero && hasRecentIncident ? (
    // Compact empty state, ONLY when it must share the never-wrapping hero row
    // with the incident badge: the full two-paragraph box (below) would push
    // the incident chip off-screen at the 375px minimum width, and recent harm
    // must stay visible (ADR-007). The honest "Not yet attested" text label
    // stays visible; the guidance sentence moves into the chip's tooltip
    // (keyboard-reachable like the other badges, and announced on focus via
    // the tooltip's aria-describedby wiring).
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
    // Full empty-state box: the default variant, and the hero WITHOUT an
    // incident (the row then holds only this box, so there is nothing to push
    // off-screen). In the hero's overflow row the box is `shrink-0`, so it
    // needs a width cap — without one a flex item's base size is its
    // max-content width (the whole guidance sentence unwrapped) and the row
    // would scroll for no reason at the 375px minimum width.
    <div
      className={`flex shrink-0 flex-col gap-1 rounded-card border border-dashed border-border bg-muted p-gutter${
        isHero ? " max-w-xs sm:max-w-sm" : ""
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
        // Chrome-reset <fieldset> + sr-only <legend> (the repo's ViewToggle
        // pattern, and what Biome's useSemanticElements rule prefers over
        // role="group") gives the badge row an exposed group role + accessible
        // name distinct from the section's own name — an aria-label on a
        // role-less (generic) div is ignored by most AT. `min-w-0` overrides a
        // <fieldset>'s UA-stylesheet auto min-width so the row can actually
        // shrink and hand overflow to `overflow-x-auto` instead of forcing the
        // hero wider than the viewport at the 375px minimum width. The `p-1`
        // padding (compensated by `-m-1` so the layout doesn't shift) keeps
        // each trigger's 2px focus-visible ring inside the scroll container —
        // without it, `overflow-x-auto` clips the ring's box-shadow.
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
