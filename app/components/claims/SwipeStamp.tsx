import { Check, type LucideIcon, ShieldCheck, X } from "lucide-react";
import { type MotionValue, motion } from "motion/react";
import { cn } from "~/lib/utils";

/**
 * The drag stamp on a claim card: an icon + word pair that fades in as the
 * card is dragged toward Confirm (right) or Dispute (left). Never colour alone
 * (styling.md non-negotiable): the word "Confirm"/"Dispute" is always part of
 * the stamp.
 *
 * Tints follow the safety rules:
 *   - Headline card: Confirm = celiac-safe green + ShieldCheck. Dispute takes
 *     the neutral fact treatment — a dispute records "not celiac-safe", not a
 *     lesser safety state, so it must not carry a verdict colour of its own.
 *   - Fact cards: neutral foreground/brand tints with plain Check / X glyphs —
 *     a plain fact must never borrow the safety verdict colours.
 *
 * The stamp is `aria-hidden`: it is a sighted drag affordance; the accessible
 * meaning lives in the always-visible button row + the deck's live region.
 *
 * Two rendering modes:
 *   - Full motion: opacity is bound to the drag-derived {@link MotionValue}, so
 *     the stamp tracks drag distance.
 *   - Reduced motion (`dragOpacity` undefined): the stamp is hidden until the
 *     card exits, then the matching stamp appears at full opacity via the exit
 *     variant. The variant's `custom` is the deck's exit answer.
 */
export function SwipeStamp({
  kind,
  isHeadline,
  dragOpacity,
}: {
  kind: "confirm" | "dispute";
  isHeadline: boolean;
  /** Drag-tracked opacity; omit under reduced motion (variant-driven instead). */
  dragOpacity?: MotionValue<number> | undefined;
}) {
  const confirm = kind === "confirm";
  const headlineConfirm = isHeadline && confirm;
  const Icon: LucideIcon = headlineConfirm ? ShieldCheck : confirm ? Check : X;
  // The headline confirm stamp rides on the soft celiac-safe fill (kept light
  // in both themes — styling.md dark-mode rule) so the strong-colour text stays
  // WCAG AA in dark mode too; `text-celiac-safe` on the dark surface would not
  // be. Every other stamp is neutral on the card surface — never a safety
  // verdict colour.
  const tint = headlineConfirm
    ? "border-celiac-safe bg-celiac-safe-soft text-celiac-safe"
    : "border-foreground/70 bg-surface/90 text-foreground";

  const box = cn(
    "pointer-events-none absolute top-4 inline-flex items-center gap-1.5 rounded-card border-2 px-3 py-1.5 font-display text-body-sm font-bold uppercase tracking-wide",
    confirm ? "left-4 -rotate-12" : "right-4 rotate-12",
    tint
  );

  if (dragOpacity === undefined) {
    // Reduced motion: invisible until the card's exit variant reveals the
    // stamp matching the chosen answer, at full opacity, instantly.
    return (
      <motion.span
        aria-hidden="true"
        data-testid={`swipe-stamp-${kind}`}
        className={box}
        variants={{
          enter: { opacity: 0 },
          center: { opacity: 0 },
          exit: (direction: string) => ({
            opacity: direction === kind ? 1 : 0,
            transition: { duration: 0 },
          }),
        }}
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.4} />
        {confirm ? "Confirm" : "Dispute"}
      </motion.span>
    );
  }

  return (
    <motion.span
      aria-hidden="true"
      data-testid={`swipe-stamp-${kind}`}
      className={box}
      style={{ opacity: dragOpacity }}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.4} />
      {confirm ? "Confirm" : "Dispute"}
    </motion.span>
  );
}
