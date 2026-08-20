import { SafetySignal } from "~/components/SafetySignal";
import { formatIncidentDate, relativeIncidentDate } from "./incident-format";

interface RecentIncidentBannerProps {
  /** Calendar date (`YYYY-MM-DD`) of the most recent in-window incident. */
  occurredOn: string;
  /**
   * Reference instant as epoch ms, resolved once server-side and threaded down
   * so the relative phrasing matches the recency check (no SSR/client drift).
   */
  nowMs?: number;
}

/**
 * Prominent warning shown near the top of a listing when a recent "got glutened"
 * incident exists — fresh harm is never buried beneath older confirmations
 * (ADR-007, domain.md trust model).
 *
 * Accessibility: a labelled `<output>` polite live region (implicit `role="status"`)
 * carrying the `incident` safety signal (icon + "Recent incident" label + colour) —
 * meaning never rests on colour alone (docs/agents/styling.md). A live region, not
 * a passive landmark, so assistive tech announces it when it materialises
 * post-navigation/filter on the client. Polite `status`, not assertive `alert`,
 * because it is also SSR'd on load; `alert` stays reserved for the report form's
 * post-submit error.
 *
 * The pill carries only the plain "Recent incident" label with `whitespace-nowrap`;
 * the relative recency lives in the body copy alongside the absolute date, where it
 * wraps naturally. The whole `<output>` is one live region, so screen readers still
 * announce the pill and the recency sentence together.
 *
 * A small, prop-only component so the same cue is reusable on other surfaces.
 */
export function RecentIncidentBanner({ occurredOn, nowMs }: RecentIncidentBannerProps) {
  const relative = relativeIncidentDate(
    occurredOn,
    nowMs !== undefined ? new Date(nowMs) : undefined
  );
  return (
    // `<output>` is the project's semantic polite-live-region element (implicit
    // role="status"). aria-live stays explicit, with an accessible name for the
    // announcement.
    <output
      aria-live="polite"
      aria-label="Recent incident warning"
      className="flex flex-col gap-2 rounded-card border border-incident/30 border-l-4 border-l-incident bg-incident-soft p-gutter sm:flex-row sm:items-center sm:gap-3"
    >
      {/* Plain "Recent incident" label only — `whitespace-nowrap` keeps the pill on
          one line at every width; the recency detail lives in the body sentence,
          which wraps naturally instead of breaking the pill. */}
      <SafetySignal state="incident" variant="solid" className="self-start whitespace-nowrap" />
      <p className="text-body-sm text-incident">
        A diner reported getting glutened here on {formatIncidentDate(occurredOn)} ({relative}).
        Recent reports show regardless of older confirmations. Check the reports below before you
        decide.
      </p>
    </output>
  );
}
