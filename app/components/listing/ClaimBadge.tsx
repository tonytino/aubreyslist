import { Sparkles } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type { ClaimAttribute } from "~/listings/taxonomy";
import { CLAIM_ATTRIBUTE_ICONS, CLAIM_ATTRIBUTE_LABELS } from "~/trust/summary";

export interface ClaimBadgeProps {
  /** Which taxonomy attribute this badge represents (drives its icon + label). */
  attribute: ClaimAttribute;
  /**
   * True when this attribute is a LIVE curator-bot suggestion rather than a
   * community-confirmed claim (ADR-007: provenance, never a verdict — callers
   * should only pass `true` while there is no real evidence yet, matching
   * {@link import("~/trust/summary").summarizeClaim}'s `suggested` guard).
   *
   * The suggested variant swaps the attribute's own glyph for the `Sparkles`
   * "AI-suggested" icon, wraps the chip in a vibrant purple gradient ring, and
   * moves the "suggested, not yet confirmed" gloss into a tooltip rather than a
   * visible text prefix — a deliberately subtler treatment than a screaming
   * label, on the owner's call that the icon + gradient + tooltip together are
   * enough to keep it from reading as a confirmed claim.
   */
  suggested?: boolean;
  className?: string;
}

/**
 * The single, shared per-claim badge — icon + label, taxonomy-driven — for any
 * surface that shows "which claims apply to this listing" (browse cards, the
 * listing-detail hero). Exported so every such surface renders the SAME badge
 * instead of hand-assembling its own icon+label(+tooltip) chip, which is how
 * attributes like `off_menu_gf_on_request` ended up missing from some surfaces
 * while present on others.
 */
export function ClaimBadge({ attribute, suggested = false, className }: ClaimBadgeProps) {
  const label = CLAIM_ATTRIBUTE_LABELS[attribute];
  const Icon = suggested ? Sparkles : CLAIM_ATTRIBUTE_ICONS[attribute];

  const chip = (
    <Badge
      variant="outline"
      data-testid={suggested ? "suggested-attribute" : "claim-badge"}
      className={cn(
        "gap-1 px-2.5 py-1 text-caption font-medium text-foreground",
        suggested ? "border-transparent bg-background" : "border-brand/25 bg-brand-soft",
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {/* Screen-reader-only "Suggested: " prefix: the visible chip carries the
          distinction via the Sparkles icon + gradient ring alone (no visible
          text prefix, per the owner's subtler-styling call), but the
          accessible name must still differ from a same-label real control
          elsewhere on the page (e.g. the browse filter's "Dedicated fryer"
          chip) — without this, both resolve to the identical accessible name
          and role, an ambiguity for assistive tech as real as the visual one
          the icon/gradient already solve for sighted users. */}
      {suggested ? <span className="sr-only">Suggested: </span> : null}
      <span>{label}</span>
    </Badge>
  );

  if (!suggested) {
    return chip;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 cursor-help rounded-md bg-gradient-to-r from-brand via-accent-lavender to-accent-peach p-[1.5px] outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          {chip}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        Suggested by Aubrey's Bot — not yet confirmed by the community.
      </TooltipContent>
    </Tooltip>
  );
}
