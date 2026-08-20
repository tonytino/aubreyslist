import { Sparkles } from "lucide-react";
import { BADGE_FAMILY_SIZE } from "~/components/badge-size";
import { Badge } from "~/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import type { ClaimAttribute } from "~/db/schema";
import { cn } from "~/lib/utils";
import type { ClaimAggregate } from "~/server/attestations";
import { type ClaimTrustSummary, claimAttributeDescription, summarizeClaim } from "~/trust/summary";
import { SuggestedRing } from "./SuggestedRing";

interface ClaimTrustSummaryProps {
  /** The claim's attribute (its taxonomy slot — drives the label). */
  attribute: ClaimAttribute;
  /**
   * The claim's aggregate — visible confirm/dispute counts + recency, plus the
   * optional curator-bot `suggested` flag. `suggested` is optional so a bare
   * `{confirm,dispute,lastConfirmed}` Pick still type-checks; when true (and there
   * is no real evidence) the row shows the "Suggested by Aubrey's Bot" badge.
   */
  aggregate: Pick<ClaimAggregate, "confirmCount" | "disputeCount" | "lastConfirmedAt"> &
    Partial<Pick<ClaimAggregate, "suggested">>;
  /**
   * "Now" override, for deterministic tests. Defaults to the current time so
   * the recency phrase ("last confirmed 3 weeks ago") is relative to render.
   */
  now?: Date | undefined;
  /** Admin-tuned staleness window in months (ADR-007). Defaults to 6. */
  stalenessMonths?: number | undefined;
  className?: string | undefined;
}

/**
 * Transparent per-claim trust summary (ADR-007) — a roll-up of visible evidence,
 * never a secret score. Renders e.g.
 *
 *   Dedicated fryer
 *   8 confirm / 1 dispute · last confirmed 3 weeks ago
 *
 * Every value shown is derivable from evidence the user can also see. See
 * {@link summarizeClaim}.
 *
 * Takes only `attribute` + `aggregate` (no DB, no route coupling), so any surface
 * can render the same summary. Meaning is carried in text + (for a stale claim) an
 * explicit "Needs update" word — never colour alone.
 */
export function ClaimTrustSummaryRow({
  attribute,
  aggregate,
  now,
  stalenessMonths,
  className,
}: ClaimTrustSummaryProps) {
  const summary: ClaimTrustSummary = summarizeClaim(attribute, aggregate, now, stalenessMonths);
  const description = claimAttributeDescription(attribute);

  return (
    <div className={`flex flex-col gap-1${className ? ` ${className}` : ""}`}>
      <p className="text-body font-semibold text-foreground">{summary.label}</p>

      {/* Every attribute carries a one-line descriptor — clarifying confirm/dispute
          meaning for the headline and stating the plain fact for the rest — so a
          vote is never ambiguous. */}
      <p className="text-caption text-muted-foreground">{description}</p>

      {summary.hasEvidence ? (
        <p className="text-body-sm text-muted-foreground">
          <span>{summary.countsLabel}</span>
          <span aria-hidden="true"> · </span>
          <span>{summary.recencyLabel}</span>
          {summary.stale ? (
            <>
              <span aria-hidden="true"> · </span>
              <span className="font-medium text-stale">Needs update</span>
            </>
          ) : null}
        </p>
      ) : summary.suggested ? (
        // Curator-bot suggestion: a starter label seeded by "Aubrey's Bot" from
        // public info, not community evidence. Renders through the shared
        // `SuggestedRing` primitive + `Badge` shell at `BADGE_FAMILY_SIZE`, the same
        // suggested treatment as `ClaimBadge`'s suggested variant. The content
        // differs by design: this is the full-text provenance chip, whereas
        // `ClaimBadge` keeps the attribute's icon + an "AI" marker. It clears the
        // instant a real user confirms or disputes.
        <SuggestedRing>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                data-testid="suggested-provenance"
                className={cn(
                  BADGE_FAMILY_SIZE,
                  "cursor-help border-transparent bg-background text-foreground"
                )}
              >
                <Sparkles aria-hidden="true" />
                <span>Suggested by Aubrey's Bot</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Suggested by Aubrey's Bot</TooltipContent>
          </Tooltip>
        </SuggestedRing>
      ) : (
        // Honest empty state: a claim exists but no one has attested yet. Never
        // fabricate a verdict (a celiac could be hurt) — domain.md. The lead
        // mirrors the browse card's empty chip.
        <p className="text-body-sm text-muted-foreground">
          <span className="font-medium text-foreground">Not yet attested</span>, no confirmations or
          disputes yet
        </p>
      )}
    </div>
  );
}
