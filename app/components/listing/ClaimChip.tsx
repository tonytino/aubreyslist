import { Slot, Slottable } from "@radix-ui/react-slot";
import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import type { ReactNode } from "react";
import { BADGE_FAMILY_SIZE } from "~/components/badge-size";
import { cn } from "~/lib/utils";

/**
 * The box + layout every chip in the claim badge family shares, BEFORE size and
 * tint. Deliberately colour/background-free: the leading glyph, the label span,
 * `border` (width only — the colour is a caller concern), the inline-flex layout
 * and `[&>svg]` handling are the truly shared invariants. Callers layer their own
 * fill/tint/interactive utilities on top via `className`, so this string never
 * conflicts with them under either `cn()` (static path) or Radix `Slot`'s
 * className concatenation (the `asChild` path). NOTE: no `overflow-hidden` here —
 * the interactive vote toggle paints a `focus-visible` ring OUTSIDE its box, and
 * clipping it would break that focus affordance.
 */
const CLAIM_CHIP_BOX =
  "inline-flex w-fit shrink-0 items-center justify-center whitespace-nowrap border outline-none [&>svg]:pointer-events-none [&>svg]:shrink-0";

export interface ClaimChipProps extends Omit<React.ComponentProps<"span">, "children"> {
  /** Leading, decorative glyph — meaning lives in the visible {@link label}. */
  icon: LucideIcon;
  /** Props forwarded to the glyph (e.g. `strokeWidth` for the bolder vote toggle). */
  iconProps?: React.ComponentProps<LucideIcon>;
  /** The always-present visible text label — so meaning never rests on colour alone. */
  label: ReactNode;
  /** Trailing content rendered AFTER the label (e.g. the "AI" provenance marker). */
  trailing?: ReactNode;
  /**
   * Render THROUGH the single child element (e.g. a `<button>`) via Radix `Slot`
   * instead of the default `<span>`, so the interactive vote toggle IS this exact
   * chip — same icon + label + family size/shape — with the child supplying ONLY
   * its interactive concerns (`aria-pressed`, `disabled`, `onClick`, the pressed
   * fill, the focus-visible ring). `Slot` merges this chip's className + the
   * icon/label content onto that child; `Slottable` marks which child becomes the
   * rendered element while the icon/label render as its content.
   */
  asChild?: boolean;
  /** The element to render as when {@link asChild} is set (a single React element). */
  children?: ReactNode;
}

/**
 * The ONE per-claim chip primitive (AUB-227 V2): a leading taxonomy/state glyph +
 * a visible text label at the shared {@link BADGE_FAMILY_SIZE}. Every claim-family
 * chip composes it so they are LITERALLY the same component, not implementations
 * kept in visual sync:
 *
 *   - the static {@link import("./ClaimBadge").ClaimBadge} (per-claim display chip),
 *   - the add-listing review {@link import("~/components/add-listing/ReviewStep").FactOutcomeChip},
 *   - the interactive vote toggle ({@link import("./ClaimVoteControls").ClaimVoteControls}'s
 *     `VoteBadgeButton`), via `asChild` onto a real native `<button>`.
 *
 * The chip owns only the shared visual (box, family size/shape, `aria-hidden`
 * glyph, label span). Fills/tints and — for the vote toggle — every interactive
 * concern stay with the caller, so the toggle adds its semantics WITHOUT the chip
 * having to know it is interactive. The `claim-chip-parity.test.tsx` guard keeps
 * the static surfaces from drifting on icon/label/size.
 */
export function ClaimChip({
  icon: Icon,
  iconProps,
  label,
  trailing,
  asChild = false,
  className,
  children,
  ...rest
}: ClaimChipProps) {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp className={cn(CLAIM_CHIP_BOX, BADGE_FAMILY_SIZE, className)} {...rest}>
      <Icon aria-hidden="true" {...iconProps} />
      <span>{label}</span>
      {trailing}
      {asChild ? <Slottable>{children}</Slottable> : null}
    </Comp>
  );
}
