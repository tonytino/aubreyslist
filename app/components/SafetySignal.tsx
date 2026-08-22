import { Clock, type LucideIcon, ShieldCheck, TriangleAlert } from "lucide-react";
import type * as React from "react";
import { cn } from "~/lib/utils";
import { BADGE_FAMILY_SIZE } from "./badge-size";
import { WheatStrike } from "./icons/WheatStrike";
import { Badge } from "./ui/badge";

/**
 * The four safety/trust states surfaced across the app. See
 * docs/agents/domain.md (GF taxonomy + trust model):
 *   - celiac-safe      — takes cross-contamination seriously (headline trust)
 *   - gluten-friendly  — GF-ish options only; deliberately not "safe"
 *   - stale            — claim not confirmed within the staleness window
 *   - incident         — a recent "got glutened" report flags the listing
 */
export type SafetyState = "celiac-safe" | "gluten-friendly" | "stale" | "incident";

interface SafetyStateConfig {
  /** Always-visible text label. Safety meaning is never colour-only. */
  label: string;
  /** Tailwind utilities for the strong (solid) variant. */
  solid: string;
  /** Tailwind utilities for the soft (pastel-filled) variant. */
  soft: string;
  /** Distinct lucide glyph per state — shape carries meaning, not just colour. */
  icon: LucideIcon;
}

/**
 * Each state is differentiated three independent ways — colour, icon shape, and
 * text label — so the signal survives colour-blindness, greyscale, and pastel
 * de-saturation. The foreground tokens meet WCAG AA against both white and the
 * matching `-soft` fill.
 */
const STATES: Record<SafetyState, SafetyStateConfig> = {
  "celiac-safe": {
    label: "Celiac-safe",
    solid: "bg-celiac-safe text-celiac-safe-foreground border border-transparent",
    soft: "bg-celiac-safe-soft text-celiac-safe border border-celiac-safe/30",
    // shield + check — headline trust
    icon: ShieldCheck,
  },
  "gluten-friendly": {
    label: "Gluten-friendly",
    solid: "bg-gluten-friendly text-gluten-friendly-foreground border border-transparent",
    soft: "bg-gluten-friendly-soft text-gluten-friendly border border-gluten-friendly/30",
    // Ear-of-wheat with a diagonal strike ("gluten struck out"). Distinct from
    // the other three glyphs even in greyscale.
    icon: WheatStrike,
  },
  stale: {
    label: "Needs update",
    solid: "bg-stale text-stale-foreground border border-transparent",
    soft: "bg-stale-soft text-stale border border-stale/30",
    // clock — freshness/recency
    icon: Clock,
  },
  incident: {
    label: "Recent incident",
    solid: "bg-incident text-incident-foreground border border-transparent",
    soft: "bg-incident-soft text-incident border border-incident/30",
    // warning triangle — recent harm
    icon: TriangleAlert,
  },
};

interface SafetySignalProps extends Omit<React.ComponentProps<"span">, "children"> {
  state: SafetyState;
  /** `solid` for high emphasis, `soft` for inline/pastel chips. Defaults to `soft`. */
  variant?: "solid" | "soft";
  /**
   * Override the default label text (e.g. "Verified celiac-safe"). Keep it
   * short — the chip never wraps, so a long interpolated label overflows its
   * row on mobile instead.
   */
  label?: string;
}

/**
 * Reusable, accessible safety-signal chip.
 *
 * Invariant: every render pairs colour + icon + text label. The icon is
 * decorative (`aria-hidden`); the meaning lives in the visible label. Never
 * render this signal with colour alone.
 *
 * Forwards extra span props (and `ref`) to the root `<span>`, so a call site
 * can wrap it in a shadcn `Tooltip` via `<TooltipTrigger asChild>` with the
 * {@link SAFETY_TOOLTIP} copy — the tooltip stays supplementary.
 */
export function SafetySignal({
  state,
  variant = "soft",
  label,
  className,
  ...rest
}: SafetySignalProps) {
  const config = STATES[state];
  const text = label ?? config.label;
  const Icon = config.icon;

  return (
    <span
      data-safety-state={state}
      // {@link BADGE_FAMILY_SIZE} keeps this chip the same size as `ClaimBadge`;
      // only the fill differs. The icon is sized by that constant's
      // `[&>svg]:size-4`, not a per-glyph class.
      //
      // `shrink-0 whitespace-nowrap` matches `ClaimChip`'s box: every chip in the
      // badge family is a one-line pill. Without it this chip is the only family
      // member that squeezes and wraps its label when a flex row runs out of room
      // — which is exactly what a horizontally scrolling badge row (the browse
      // card, the detail hero) hands it. Overflow belongs to the row's scroller,
      // never to the chip's own height.
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap",
        BADGE_FAMILY_SIZE,
        variant === "solid" ? config.solid : config.soft,
        className
      )}
      {...rest}
    >
      <Icon aria-hidden="true" className="shrink-0" strokeWidth={2.25} />
      <span>{text}</span>
    </span>
  );
}

/**
 * Canonical per-state explainer copy — the single source of this wording
 * (docs/product/overview.md, docs/agents/domain.md). Call sites that wrap a
 * safety chip in a `Tooltip` pass the matching entry so the explanation reads
 * the same everywhere. The tooltip is always supplementary: meaning never
 * rests on it.
 */
export const SAFETY_TOOLTIP: Record<SafetyState, string> = {
  "celiac-safe":
    "Takes cross-contamination seriously. The kitchen is set up to serve people with celiac disease safely.",
  "gluten-friendly":
    "Offers gluten-free options but doesn't guarantee against cross-contamination. Not a celiac-safe promise.",
  stale:
    "Not confirmed in the last six months, so this may be out of date. We show that rather than hide it.",
  incident:
    'A recent "got glutened here" report flags this listing no matter how many older confirmations it has.',
};

/** Exposed so consumers (filters, legends, the style guide) can enumerate states. */
export const SAFETY_STATES: readonly SafetyState[] = [
  "celiac-safe",
  "gluten-friendly",
  "stale",
  "incident",
];

export function safetyLabel(state: SafetyState): string {
  return STATES[state].label;
}

/**
 * The state's distinct glyph — the single icon source for every surface that
 * draws a safety state (this chip, the map pins), so the shape mapping can
 * never drift between them.
 */
export function safetyIcon(state: SafetyState): LucideIcon {
  return STATES[state].icon;
}

/**
 * The honest empty-state chip for a `null` safety verdict — dashed, neutral,
 * plain text, never a fabricated signal. The ONE implementation both the
 * browse list card (`ListingCard`) and the map mini-card (`map-ui`) render, so
 * the empty state can't drift between surfaces. Callers apply the same
 * `suggestedByBot` gate `ListingCard` documents: a bot-suggested listing with
 * no verdict shows provenance instead of this chip.
 */
export function UnattestedBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-dashed px-2.5 py-1 text-body-sm font-medium text-muted-foreground",
        className
      )}
    >
      Not yet attested
    </Badge>
  );
}
