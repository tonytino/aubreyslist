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
 * Prominent warning shown near the top of a listing when a RECENT "got
 * glutened" incident exists — fresh harm is never buried beneath older
 * confirmations (ADR-007, domain.md → Trust Model: "Recent incidents flag the
 * summary").
 *
 * Accessibility: a labelled `role="region"` carrying the `incident` safety
 * signal (warning-triangle icon + the "Recent incident" text label + colour) —
 * meaning never rests on colour alone (docs/agents/styling.md, NON-NEGOTIABLE).
 * It is a region rather than `role="alert"` because it is server-rendered on
 * load (a static fact, not a live update); `alert` is reserved for the
 * post-submit error message in the report form.
 *
 * Kept as its own small, prop-only component so the same recent-incident cue can
 * be reused by the browse list-card signal that lands with issue #33 (the browse
 * list does not exist yet).
 */
export function RecentIncidentBanner({ occurredOn, nowMs }: RecentIncidentBannerProps) {
  const relative = relativeIncidentDate(
    occurredOn,
    nowMs !== undefined ? new Date(nowMs) : undefined
  );
  return (
    <section
      aria-label="Recent incident warning"
      className="flex flex-col gap-2 rounded-card border border-incident/30 bg-incident-soft p-gutter sm:flex-row sm:items-center sm:gap-3"
    >
      <SafetySignal
        state="incident"
        variant="solid"
        label={`Recent incident · ${relative}`}
        className="self-start"
      />
      <p className="text-body-sm text-incident">
        A diner reported getting glutened here on {formatIncidentDate(occurredOn)}. Recent reports
        are shown regardless of older confirmations — check the incident reports below before you
        decide.
      </p>
    </section>
  );
}
