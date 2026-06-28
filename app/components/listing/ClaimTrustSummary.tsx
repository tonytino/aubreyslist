import type { ClaimAttribute } from "~/db/schema";
import type { ClaimAggregate } from "~/server/attestations";
import { type ClaimTrustSummary, summarizeClaim } from "~/trust/summary";

interface ClaimTrustSummaryProps {
  /** The claim's attribute (its taxonomy slot — drives the label). */
  attribute: ClaimAttribute;
  /** The claim's aggregate — visible confirm/dispute counts + recency. */
  aggregate: Pick<ClaimAggregate, "confirmCount" | "disputeCount" | "lastConfirmedAt">;
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
 * (for a stale claim) an explicit "May be stale" word — never colour alone.
 */
export function ClaimTrustSummaryRow({
  attribute,
  aggregate,
  now,
  stalenessMonths,
  className,
}: ClaimTrustSummaryProps) {
  const summary: ClaimTrustSummary = summarizeClaim(attribute, aggregate, now, stalenessMonths);

  return (
    <div className={`flex flex-col gap-1${className ? ` ${className}` : ""}`}>
      <p className="text-body font-semibold text-foreground">{summary.label}</p>

      {summary.hasEvidence ? (
        <p className="text-body-sm text-muted-foreground">
          <span>{summary.countsLabel}</span>
          <span aria-hidden="true"> · </span>
          <span>{summary.recencyLabel}</span>
          {summary.stale ? (
            <>
              <span aria-hidden="true"> · </span>
              <span className="font-medium text-stale">May be stale</span>
            </>
          ) : null}
        </p>
      ) : (
        // Honest empty state: a claim exists but no one has attested yet. We
        // never fabricate a verdict (a celiac could be hurt) — domain.md.
        <p className="text-body-sm text-muted-foreground">No confirmations or disputes yet</p>
      )}
    </div>
  );
}
