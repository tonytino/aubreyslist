import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type { ClaimAttribute } from "~/listings/taxonomy";
import { CLAIM_ATTRIBUTE_ICONS, CLAIM_ATTRIBUTE_LABELS } from "~/trust/summary";
import { ClaimChip } from "./ClaimChip";
import { SuggestedRing } from "./SuggestedRing";

export interface ClaimBadgeProps {
  /** Which taxonomy attribute this badge represents (drives its icon + label). */
  attribute: ClaimAttribute;
  /**
   * True when this attribute is a live curator-bot suggestion rather than a
   * community-confirmed claim (ADR-007: provenance, never a verdict). Callers pass
   * `true` only while there is no real evidence yet, matching
   * {@link import("~/trust/summary").summarizeClaim}'s `suggested` guard.
   *
   * The suggested variant keeps the attribute's own glyph; the gradient ring plus
   * the always-visible "AI" marker after the label signal "AI-suggested" without
   * hiding which attribute it is. The "AI" marker must stay real, always-painted
   * text: Radix's Tooltip never opens on touch, so a tooltip-only cue would be
   * silently unreachable for touch users — exactly the "suggestion misread as a
   * confirmed verdict" harm ADR-007 prevents. The marker is itself the only tooltip
   * trigger, but its accessible name is just "AI", never the attribute's label, so
   * it can never share an accessible name+role with a same-label real control
   * elsewhere (Playwright's `getByRole` name matching is substring-based; keeping
   * the trigger's name label-free is what prevents the collision).
   */
  suggested?: boolean;
  className?: string;
}

/**
 * The single, shared per-claim badge — icon + label, taxonomy-driven — for any
 * surface that shows "which claims apply to this listing". Every surface renders
 * this same badge instead of hand-assembling its own icon+label chip, so no
 * attribute can be present on one surface and missing from another.
 *
 * Sizing/shape comes from the shared {@link ClaimChip} primitive, so this chip is
 * the exact same component — and size — as the add-listing `FactOutcomeChip` and
 * the interactive vote toggle; only the headline `SafetySignal`'s solid fill sets
 * it apart.
 */
export function ClaimBadge({ attribute, suggested = false, className }: ClaimBadgeProps) {
  const label = CLAIM_ATTRIBUTE_LABELS[attribute];
  // The suggested variant keeps the attribute's own icon — the gradient ring +
  // "AI" marker carry the provenance, so the glyph stays informative.
  const Icon = CLAIM_ATTRIBUTE_ICONS[attribute];

  const badge = (
    <ClaimChip
      icon={Icon}
      label={label}
      data-testid={suggested ? "suggested-attribute" : "claim-badge"}
      className={cn(
        "text-foreground",
        suggested ? "border-transparent bg-background" : "border-brand/25 bg-brand-soft",
        className
      )}
      trailing={
        suggested ? (
          // The "AI" marker is real, always-painted text (never hover/focus-gated —
          // the touch-accessible path) and the tooltip's only trigger. Its
          // accessible name is deliberately just "AI", not the attribute label, so
          // it never collides with a same-label real control elsewhere (see the
          // `suggested` prop doc).
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="rounded-sm text-body-sm font-bold uppercase tracking-wide text-brand underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              >
                AI
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Suggested by Aubrey's Bot — not yet confirmed by the community.
            </TooltipContent>
          </Tooltip>
        ) : null
      }
    />
  );

  if (!suggested) {
    return badge;
  }

  // The gradient provenance ring is the one shared `SuggestedRing` primitive,
  // identical to the one behind the `ClaimTrustSummaryRow` provenance chip.
  return <SuggestedRing>{badge}</SuggestedRing>;
}
