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
   * shows a compact always-visible "AI" tag next to the icon — a terser stand-in
   * for the old "Suggested: " text prefix (owner's call: less shouty than
   * restating the full label), but still a real, always-painted text label
   * alongside the icon, never resting on colour/shape alone or on a
   * hover/focus-only tooltip. That matters because Radix's Tooltip primitive
   * never opens on touch (verified: `onPointerMove`/`onFocus`/`onClick` all
   * ignore or actively close a touch-originated interaction), so a
   * tooltip-only cue would be silently unreachable for touch users — exactly
   * the "suggestion misread as a confirmed verdict" harm ADR-007 exists to
   * prevent. The "AI" tag is itself the (only) tooltip trigger, carrying the
   * fuller "not yet confirmed by the community" gloss for anyone who does
   * hover/focus it — but its accessible name is just "AI", never the
   * attribute's own label, so it can never share an accessible name+role with
   * a same-label real control elsewhere on the page (e.g. the browse filter's
   * "Dedicated fryer" toggle — Playwright's `getByRole` name matching is
   * substring-based, so keeping the trigger's name label-free is what actually
   * prevents the collision, not a text prefix/suffix).
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

  const badge = (
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
      {suggested ? (
        // The "AI" tag is REAL, always-painted text (never hover/focus-gated —
        // the touch-accessible path) AND the tooltip's only trigger. Its
        // accessible name is deliberately just "AI", not the attribute label,
        // so it never collides with a same-label real control elsewhere (see
        // the `suggested` prop doc above).
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="rounded-sm text-[10px] font-bold uppercase tracking-wide text-brand underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            >
              AI
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Suggested by Aubrey's Bot — not yet confirmed by the community.
          </TooltipContent>
        </Tooltip>
      ) : null}
      <span>{label}</span>
    </Badge>
  );

  if (!suggested) {
    return badge;
  }

  return (
    <span className="inline-flex shrink-0 rounded-md bg-gradient-to-r from-brand via-accent-lavender to-accent-peach p-[1.5px]">
      {badge}
    </span>
  );
}
