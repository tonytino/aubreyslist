import { Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import type { ClaimAttribute } from "~/db/schema";
import type { ClaimAggregate } from "~/server/attestations";
import { type ClaimTrustSummary, claimAttributeDescription, summarizeClaim } from "~/trust/summary";

interface ClaimTrustSummaryProps {
  /** The claim's attribute (its taxonomy slot — drives the label). */
  attribute: ClaimAttribute;
  /**
   * The claim's aggregate — visible confirm/dispute counts + recency, plus the
   * optional curator-bot `suggested` flag (AUB-31). `suggested` is optional so a
   * bare `{confirm,dispute,lastConfirmed}` Pick still type-checks; when true (and
   * there is no real evidence) the row shows the "Suggested by Aubrey's Bot" badge.
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
 * Transparent per-claim trust summary (issue #29, ADR-007) — a roll-up of
 * VISIBLE evidence, never a secret score. Renders e.g.
 *
 *   Dedicated fryer
 *   8 confirm / 1 dispute · last confirmed 3 weeks ago
 *
 * Every value shown is derivable from evidence the user can also see (the
 * confirm/dispute counts are of the visible attestations; the recency is the
 * stored "last confirmed" timestamp). See {@link summarizeClaim}.
 *
 * REUSABLE / DROP-IN: this component takes only an `attribute` + `aggregate`
 * (no DB, no route coupling), so the browse-list cards (#33) can render the
 * same summary without change. Accessibility: meaning is carried in text +
 * (for a stale claim) an explicit "Needs update" word — never colour alone.
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
          meaning for the headline (e.g. "Celiac-safe", issue #175) and stating the
          plain fact for the rest — so a vote is never ambiguous. */}
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
        // Curator-bot suggestion (AUB-31): a starter label seeded by "Aubrey's
        // Bot" from public info, NOT community evidence. The meaning is carried in
        // text (never icon/colour alone — styling.md), and the tooltip names the
        // source. It clears the instant a real user confirms or disputes below.
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-chip bg-accent-lavender/40 px-2 py-1 text-caption font-semibold text-foreground">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Suggested by Aubrey's Bot</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>Suggested by Aubrey's Bot</TooltipContent>
        </Tooltip>
      ) : (
        // Honest empty state: a claim exists but no one has attested yet. We
        // never fabricate a verdict (a celiac could be hurt) — domain.md. The
        // "Not yet attested" lead mirrors the browse card's empty chip (AUB-131).
        <p className="text-body-sm text-muted-foreground">
          <span className="font-medium text-foreground">Not yet attested</span>, no confirmations or
          disputes yet
        </p>
      )}
    </div>
  );
}
