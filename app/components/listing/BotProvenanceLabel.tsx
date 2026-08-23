import { Sparkles } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";

/**
 * The inline bot-provenance label — the one source for the wording per size
 * ("Suggested by Aubrey's Bot" at `meta`, the short "Bot-suggested" at
 * `compact`) + Sparkles glyph + `text-brand` treatment, shared by the browse
 * card's meta row and the map mini-card's trust row. Provenance, never a
 * verdict (ADR-007); meaning lives in the text + icon, never colour alone
 * (styling.md), and `text-brand` is distinct from every safety-state colour.
 *
 * The listing-detail `ClaimTrustSummary` provenance chip stays separate by
 * design: it is a badge-family chip (`SuggestedRing` + `Badge` + tooltip at
 * `BADGE_FAMILY_SIZE`), a different chip concept per styling.md's one-chip-
 * per-concept rule — not this inline label.
 */
const LABEL_SIZES = {
  /** Inherits the surrounding row's text size (ListingCard's meta row). */
  meta: { root: "gap-1.5", icon: "h-4 w-4", label: "Suggested by Aubrey's Bot" },
  /**
   * Self-sized caption text that never wraps or shrinks, for the map
   * mini-card's horizontally scrolling trust row. The label is the repo's
   * short provenance vocabulary, "Bot-suggested": the full wording clips on
   * the 200px mini-card, and the card's accessible name still carries the
   * full provenance for AT.
   */
  compact: {
    root: "shrink-0 gap-1 whitespace-nowrap text-caption",
    icon: "size-3.5",
    label: "Bot-suggested",
  },
} as const;

export function BotProvenanceLabel({
  size = "meta",
  className,
  ...props
}: { size?: keyof typeof LABEL_SIZES } & Omit<ComponentProps<"span">, "children">) {
  const sizes = LABEL_SIZES[size];
  return (
    <span
      {...props}
      className={cn("inline-flex items-center font-semibold text-brand", sizes.root, className)}
    >
      <Sparkles className={sizes.icon} aria-hidden="true" />
      <span>{sizes.label}</span>
    </span>
  );
}
