import { Clock, type LucideIcon, ShieldCheck, TriangleAlert } from "lucide-react";
import type * as React from "react";
import { WheatStrike } from "./icons/WheatStrike";

/**
 * The four safety/trust states surfaced across the app. See
 * docs/agents/domain.md (GF taxonomy + trust model):
 *   - celiac-safe      — takes cross-contamination seriously (headline trust)
 *   - gluten-friendly  — GF-ish options only; deliberately NOT "safe"
 *   - stale            — claim not confirmed within the staleness window
 *   - incident         — a recent "got glutened" report flags the listing
 */
export type SafetyState = "celiac-safe" | "gluten-friendly" | "stale" | "incident";

interface SafetyStateConfig {
  /** Always-visible text label. Safety meaning is NEVER colour-only. */
  label: string;
  /** Tailwind utilities for the strong (solid) variant. */
  solid: string;
  /** Tailwind utilities for the soft (pastel-filled) variant. */
  soft: string;
  /** Distinct lucide glyph per state — shape carries meaning, not just colour. */
  icon: LucideIcon;
}

/**
 * Each state is differentiated three independent ways — colour, icon SHAPE, and
 * text label — so the signal survives colour-blindness, greyscale, and pastel
 * de-saturation. The foreground tokens meet WCAG AA against both white and the
 * matching `-soft` fill.
 */
const STATES: Record<SafetyState, SafetyStateConfig> = {
  "celiac-safe": {
    label: "Celiac-safe",
    solid: "bg-celiac-safe text-celiac-safe-foreground",
    soft: "bg-celiac-safe-soft text-celiac-safe border border-celiac-safe/30",
    // shield + check — headline trust
    icon: ShieldCheck,
  },
  "gluten-friendly": {
    label: "Gluten-friendly",
    solid: "bg-gluten-friendly text-gluten-friendly-foreground",
    soft: "bg-gluten-friendly-soft text-gluten-friendly border border-gluten-friendly/30",
    // brand ear-of-wheat with a diagonal strike ("gluten struck out") — reads as
    // "GF-ish options, deliberately NOT celiac-safe", and stays distinct from the
    // other three glyphs in greyscale.
    icon: WheatStrike,
  },
  stale: {
    label: "Needs update",
    solid: "bg-stale text-stale-foreground",
    soft: "bg-stale-soft text-stale border border-stale/30",
    // clock — freshness/recency
    icon: Clock,
  },
  incident: {
    label: "Recent incident",
    solid: "bg-incident text-incident-foreground",
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
   * short — a long interpolated label wraps the pill on mobile (the old
   * "Recent incident · N days ago" banner pill did exactly that).
   */
  label?: string;
}

/**
 * Reusable, accessible safety-signal chip.
 *
 * CONTRACT (do not regress): every render pairs COLOUR + ICON + TEXT LABEL.
 * The icon is decorative (`aria-hidden`) and the meaning lives in the visible
 * label, so screen readers announce the words and sighted users with colour
 * vision deficiency still get an icon shape + text. Never render this signal
 * with colour alone.
 *
 * Forwards any extra span props (and `ref`) to the root `<span>`, so a call site
 * can wrap it in a shadcn `Tooltip` via `<TooltipTrigger asChild>` and pass the
 * centralized {@link SAFETY_TOOLTIP} copy — the tooltip stays SUPPLEMENTARY; the
 * colour + icon + label already carry the meaning.
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
      className={`inline-flex items-center gap-1.5 rounded-chip px-2.5 py-1 text-body-sm font-medium ${
        variant === "solid" ? config.solid : config.soft
      }${className ? ` ${className}` : ""}`}
      {...rest}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.25} />
      <span>{text}</span>
    </span>
  );
}

/**
 * Canonical per-state explainer copy — the SINGLE source of the wording, lifted
 * from the About page's trust legend (docs/product/overview.md,
 * docs/agents/domain.md). Call sites that wrap a safety chip/badge in a shadcn
 * `Tooltip` pass the matching entry, so the supplementary explanation reads the
 * same everywhere (the About legend, the style guide, and any status chip).
 *
 * The tooltip is ALWAYS supplementary: every {@link SafetySignal} already pairs
 * colour + icon + a visible text label, so meaning never rests on the tooltip.
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
