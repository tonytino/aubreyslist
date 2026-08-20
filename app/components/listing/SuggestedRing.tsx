import type * as React from "react";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

/**
 * The purple→lavender→peach gradient ring that marks a curator-bot ("Aubrey's Bot")
 * suggestion as provenance — never a community verdict (ADR-007). A 1.5px gradient
 * border painted behind an inner chip on `bg-background`, so the chip reads as
 * "AI-suggested" without borrowing a safety colour.
 *
 * One implementation, shared by every suggested-chip surface so the treatment can
 * never drift: the {@link import("./ClaimBadge").ClaimBadge} `suggested` variant and
 * the {@link import("./ClaimTrustSummary").ClaimTrustSummaryRow} provenance chip.
 * The two keep distinct content; the ring lives here once. Forwards `ref`/extra span
 * props so a caller can make it a Radix `TooltipTrigger` via `asChild`.
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
