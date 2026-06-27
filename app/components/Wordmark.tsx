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
 * Text-based with a small inline-SVG "check + plate" glyph in brand purple.
 * The decorative mark is `aria-hidden`; the accessible name comes from the
 * styled text so assistive tech reads "Aubrey's List" once.
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
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* plate / list disc */}
        <circle cx="12" cy="12" r="9" />
        {/* affirmative check — "verified safe" */}
        <path d="M8 12.5l2.5 2.5L16 9" />
      </svg>
      <span>
        Aubrey's <span className="text-brand">List</span>
      </span>
    </span>
  );
}
