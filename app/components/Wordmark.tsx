import { useId } from "react";

interface WordmarkProps {
  /** Visual size of the wordmark. Defaults to `md`. */
  size?: "sm" | "md" | "lg";
  /** Extra utility classes for layout/positioning by the consumer. */
  className?: string;
}

const sizeText: Record<NonNullable<WordmarkProps["size"]>, string> = {
  sm: "text-body",
  md: "text-title",
  lg: "text-headline",
};

const markSize: Record<NonNullable<WordmarkProps["size"]>, string> = {
  sm: "h-5 w-5",
  md: "h-6 w-6",
  lg: "h-8 w-8",
};

/**
 * Aubrey's List brand wordmark for the app header.
 *
 * Text-based with a small inline-SVG ear-of-wheat glyph in brand purple — the
 * "gluten" symbol with a single diagonal strike wiped through it, as if erased.
 * The strike is a cutout, not a drawn line: a mask removes a diagonal band from
 * the wheat so the gap shows the background through — gluten, struck out. The
 * mask id is per-instance (`useId`) so multiple wordmarks on one page don't
 * collide. The decorative mark is `aria-hidden`; the accessible name comes from
 * the styled text so assistive tech reads "Aubrey's List" once.
 */
export function Wordmark({ size = "md", className }: WordmarkProps) {
  // Per-instance id so the mask reference is unique when the wordmark renders
  // more than once on a page (e.g. the style guide). Strip colons from React's
  // generated id so it is a safe `url(#…)` fragment reference.
  const maskId = `wheat-strike-${useId().replace(/:/g, "")}`;
  return (
    <span
      className={`inline-flex items-center gap-2 font-semibold text-foreground ${sizeText[size]}${
        className ? ` ${className}` : ""
      }`}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        className={`${markSize[size]} text-brand`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* The diagonal strike, wiped out of the wheat as a cutout (not drawn):
            white keeps the wheat, the black band erases a diagonal through it. */}
        <mask id={maskId}>
          <rect width="24" height="24" fill="#fff" />
          <line
            x1="18"
            y1="6"
            x2="6"
            y2="18"
            stroke="#000"
            strokeWidth="2.86"
            strokeLinecap="round"
          />
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
      <span>
        Aubrey's <span className="text-brand">List</span>
      </span>
    </span>
  );
}
