import type { ReactNode } from "react";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "~/components/ui/card";

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
 * Built on the shared `Card` primitive so the admin shell reads consistently
 * with the rest of the app (home, listings) and is correct in light AND dark
 * mode via the semantic `bg-card` / `text-card-foreground` tokens. A `<section>`
 * landmark wraps the card and is labelled (via `aria-labelledby`) by the card's
 * `<h2>`, so the shell stays navigable by landmark/heading. Future features
 * render their real UI into the `children` slot without changing this frame.
 */
export function AdminSection({ title, description, badge, children }: AdminSectionProps) {
  const headingId = `${slugify(title)}-heading`;
  return (
    <section aria-labelledby={headingId}>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={headingId} className="text-title font-semibold leading-none">
              {title}
            </h2>
            {badge ? <Badge variant="secondary">{badge}</Badge> : null}
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {children ? <CardContent>{children}</CardContent> : null}
      </Card>
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
