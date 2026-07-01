import { Clock, Leaf, type LucideIcon, ShieldCheck, TriangleAlert } from "lucide-react";

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
    // leaf — "GF-ish options, not safe"
    icon: Leaf,
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

interface SafetySignalProps {
  state: SafetyState;
  /** `solid` for high emphasis, `soft` for inline/pastel chips. Defaults to `soft`. */
  variant?: "solid" | "soft";
  /** Override the default label text (e.g. "Recent incident · 3 days ago"). */
  label?: string;
  className?: string;
}

/**
 * Reusable, accessible safety-signal chip.
 *
 * CONTRACT (do not regress): every render pairs COLOUR + ICON + TEXT LABEL.
 * The icon is decorative (`aria-hidden`) and the meaning lives in the visible
 * label, so screen readers announce the words and sighted users with colour
 * vision deficiency still get an icon shape + text. Never render this signal
 * with colour alone.
 */
export function SafetySignal({ state, variant = "soft", label, className }: SafetySignalProps) {
  const config = STATES[state];
  const text = label ?? config.label;
  const Icon = config.icon;

  return (
    <span
      data-safety-state={state}
      className={`inline-flex items-center gap-1.5 rounded-chip px-2.5 py-1 text-body-sm font-medium ${
        variant === "solid" ? config.solid : config.soft
      }${className ? ` ${className}` : ""}`}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.25} />
      <span>{text}</span>
    </span>
  );
}

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
