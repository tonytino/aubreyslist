import { Slot, Slottable } from "@radix-ui/react-slot";
import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import type { ReactNode } from "react";
import { BADGE_FAMILY_SIZE } from "~/components/badge-size";
import { cn } from "~/lib/utils";

/**
 * The box + layout every chip in the claim badge family shares, before size and
 * tint. Deliberately colour/background-free: callers layer their own fill/tint/
 * interactive utilities via `className`, so this string never conflicts with them
 * under `cn()` or Radix `Slot`'s className concatenation. No `overflow-hidden`
 * here — the vote toggle paints a `focus-visible` ring outside its box, and
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
  /** Trailing content rendered after the label (e.g. the "AI" provenance marker). */
  trailing?: ReactNode;
  /**
   * Render through the single child element (e.g. a `<button>`) via Radix `Slot`
   * instead of the default `<span>`, so the interactive vote toggle is this exact
   * chip — same icon + label + family size/shape — with the child supplying only
   * its interactive concerns. `Slot` merges the chip's className + content onto
   * that child; `Slottable` marks which child becomes the rendered element.
   */
  asChild?: boolean;
  /** The element to render as when {@link asChild} is set (a single React element). */
  children?: ReactNode;
}

/**
 * The one per-claim chip primitive: a leading taxonomy/state glyph + a visible text
 * label at the shared {@link BADGE_FAMILY_SIZE}. Every claim-family chip composes it
 * so they are the same component, not implementations kept in visual sync:
 *
 *   - the static {@link import("./ClaimBadge").ClaimBadge} (per-claim display chip),
 *   - the add-listing review {@link import("~/components/add-listing/ReviewStep").FactOutcomeChip},
 *   - the interactive vote toggle ({@link import("./ClaimVoteControls").ClaimVoteControls}'s
 *     `VoteBadgeButton`), via `asChild` onto a real native `<button>`.
 *
 * The chip owns only the shared visual (box, family size/shape, `aria-hidden`
 * glyph, label span). Fills/tints and interactive concerns stay with the caller, so
 * the toggle adds its semantics without the chip knowing it is interactive. The
 * `claim-chip-parity.test.tsx` guard keeps the static surfaces from drifting on
 * icon/label/size.
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
