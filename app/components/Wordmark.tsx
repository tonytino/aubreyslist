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
 * "gluten" symbol set as if inside the universal "no gluten" prohibition mark,
 * but with the ring + slash rendered invisible (the `no-symbol` group has no
 * stroke): gluten, with the "no" made silent. The decorative mark is
 * `aria-hidden`; the accessible name comes from the styled text so assistive
 * tech reads "Aubrey's List" once.
 */
export function Wordmark({ size = "md", className }: WordmarkProps) {
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
        {/* Prohibition ring + slash — present but invisibly rendered. */}
        <g className="no-symbol" stroke="none">
          <circle cx="12" cy="12" r="10.5" />
          <line x1="4.6" y1="19.4" x2="19.4" y2="4.6" />
        </g>
        {/* Ear of wheat: central stalk, top awns, three tiers of grains. */}
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
      </svg>
      <span>
        Aubrey's <span className="text-brand">List</span>
      </span>
    </span>
  );
}
