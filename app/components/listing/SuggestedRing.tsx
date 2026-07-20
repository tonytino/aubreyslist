import type * as React from "react";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

/**
 * The vibrant purple→lavender→peach gradient RING that marks a curator-bot
 * ("Aubrey's Bot") SUGGESTION as provenance — never a community verdict
 * (ADR-007). It is a 1.5px gradient border painted behind an inner chip that
 * sits on `bg-background`, so the chip reads as "AI-suggested" without borrowing
 * a safety colour.
 *
 * ONE implementation, shared by every suggested-chip surface so the treatment
 * can never drift between them:
 *   - the per-claim {@link import("./ClaimBadge").ClaimBadge} `suggested` variant
 *     (attribute glyph + label + an "AI" marker), and
 *   - the {@link import("./ClaimTrustSummary").ClaimTrustSummaryRow} provenance
 *     chip (Sparkles + "Suggested by Aubrey's Bot").
 *
 * The two keep DISTINCT content (one is a per-attribute badge, the other a
 * full-text provenance chip) but the ring itself — the actual duplicated visual
 * — now lives here once. Forwards `ref`/extra span props so a caller can make it
 * a Radix `TooltipTrigger` via `asChild` if needed.
 */
export function SuggestedRing({
  children,
  className,
  ...rest
}: React.ComponentProps<"span"> & { children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-chip bg-gradient-to-r from-brand via-accent-lavender to-accent-peach p-[1.5px]",
        className
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
