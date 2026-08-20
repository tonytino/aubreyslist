import type { LucideIcon, LucideProps } from "lucide-react";
import { forwardRef, useId } from "react";

/**
 * Brand "gluten struck out" glyph — an ear of wheat with a single diagonal strike
 * wiped through it as a cutout (not a drawn line), the same mark as the
 * {@link ~/components/Wordmark}. The strike is a mask that erases a diagonal band
 * from the wheat, so the gap shows the background through: gluten, struck out.
 *
 * Shaped to lucide's API so it drops into any lucide icon slot: it is typed as a
 * {@link LucideIcon}, forwards a ref to the `<svg>`, and accepts `className`,
 * `strokeWidth`, `aria-hidden`, event handlers, etc., rendering at the same
 * 24×24 box as `ShieldCheck` / `Clock` / `TriangleAlert`. Consumers size it with
 * a utility class (e.g. `size-4`), exactly like the lucide state icons.
 *
 * Decorative: safety meaning always lives in the adjacent text label, so the
 * consumer passes `aria-hidden`. The mask id is per-instance (`useId`) so many
 * chips on one page (e.g. the browse grid) never collide on `url(#…)`.
 */
export const WheatStrike = forwardRef<SVGSVGElement, LucideProps>(function WheatStrike(
  { className, strokeWidth = 2, ...props },
  ref
) {
  // Strip colons from React's generated id so it is a safe `url(#…)` fragment.
  const maskId = `wheat-strike-icon-${useId().replace(/:/g, "")}`;
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      // Decorative brand glyph — safety meaning always lives in the adjacent text
      // label. Hardcoded here (like the Wordmark mark) so the icon is hidden from
      // assistive tech by default; a consumer can still override via props.
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* The diagonal strike, wiped out of the wheat as a cutout: white keeps the
          wheat, the black band erases a diagonal through it. The cutout is 3.5 wide
          (not 3) so the "struck-out" gap stays legible — and de-crowds the middle
          grains — when the glyph renders at chip size (~16px / `size-4`), where a
          narrower gap smudged shut against the surrounding strokes. */}
      <mask id={maskId}>
        <rect width="24" height="24" fill="#fff" />
        <line x1="18" y1="6" x2="6" y2="18" stroke="#000" strokeWidth="3.5" strokeLinecap="round" />
      </mask>
      {/* Ear of wheat: central stalk, top awns, three tiers of grains. */}
      <g mask={`url(#${maskId})`}>
        <path d="M12 21.5V9" />
        <path d="M12 9V4" />
        <path d="M12 9L9.2 5.4" />
        <path d="M12 9l2.8-3.6" />
        <path d="M12 11.5C10.4 11 9 10 8.4 8.4" />
        <path d="M12 11.5c1.6-.5 3-1.5 3.6-3.1" />
        <path d="M12 15c-1.6-.5-3-1.5-3.6-3.1" />
        <path d="M12 15c1.6-.5 3-1.5 3.6-3.1" />
        <path d="M12 18.5c-1.6-.5-3-1.5-3.6-3.1" />
        <path d="M12 18.5c1.6-.5 3-1.5 3.6-3.1" />
      </g>
    </svg>
  );
}) as LucideIcon;
