import type { ReactNode } from "react";

interface TrustPlaceholderProps {
  /** Visible section heading (e.g. "Community claims"). */
  title: string;
  /** Short explanation of what will eventually live here. */
  description: string;
  /**
   * Optional richer content for the empty state. When omitted, `description`
   * is the only body text. EPIC 4 (#28/#29) feeds real claim/incident data
   * into this slot by rendering it as `children`.
   */
  children?: ReactNode;
}

/**
 * Accessible, clearly-labelled empty-state slot for trust evidence that does
 * not exist yet.
 *
 * The celiac-safe vs. gluten-friendly signal and the claims/incidents lists are
 * DERIVED from attestation data that lands in EPIC 4. Until then we must not
 * fabricate a rating (see docs/agents/domain.md → Trust Model: "no opaque
 * scoring", evidence must be visible). This component renders an honest "coming
 * soon" placeholder whose body slot (`children`) can later be fed the real
 * evidence without changing the surrounding layout.
 *
 * It is a `<section>` with an explicit heading so screen-reader users can
 * navigate to it by landmark/heading, and the placeholder status is conveyed in
 * text — never colour or styling alone.
 */
export function TrustPlaceholder({ title, description, children }: TrustPlaceholderProps) {
  return (
    <section
      aria-labelledby={`${slugify(title)}-heading`}
      className="flex flex-col gap-2 rounded-card border border-dashed border-border bg-surface p-gutter"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${slugify(title)}-heading`} className="text-title">
          {title}
        </h2>
        <span className="rounded-chip bg-brand-soft px-2.5 py-1 text-caption font-medium text-brand">
          Coming soon
        </span>
      </div>
      <p className="text-body-sm text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}

/** Lower-case, hyphenated id-safe slug for wiring `aria-labelledby`. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
