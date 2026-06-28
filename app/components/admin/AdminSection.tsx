import type { ReactNode } from "react";

interface AdminSectionProps {
  /** Visible section heading (e.g. "App settings"). */
  title: string;
  /** Short explanation of what this section is / will become. */
  description: string;
  /**
   * Optional status chip text (e.g. "Coming soon", "Read-only"). Conveyed as
   * text — never colour alone — so the placeholder status survives greyscale
   * and screen readers.
   */
  badge?: string;
  /** Section body — live read-only content, or omitted for a pure placeholder. */
  children?: ReactNode;
}

/**
 * Clearly-labelled section slot for the admin panel shell (issue #38).
 *
 * Mirrors `listing/TrustPlaceholder` so the admin shell reads consistently with
 * the rest of the app: a `<section>` with an explicit heading (navigable by
 * landmark/heading) and an optional text status chip. The future features
 * (#16 role management, #24 settings write UI, #40 moderation queue) render
 * their real UI into the `children` slot without changing this frame.
 */
export function AdminSection({ title, description, badge, children }: AdminSectionProps) {
  const headingId = `${slugify(title)}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-card border border-border bg-surface p-gutter"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="text-title">
          {title}
        </h2>
        {badge ? (
          <span className="rounded-chip bg-brand-soft px-2.5 py-1 text-caption font-medium text-brand">
            {badge}
          </span>
        ) : null}
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
