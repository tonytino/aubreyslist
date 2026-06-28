import { SafetySignal } from "~/components/SafetySignal";
import { formatIncidentDate, relativeIncidentDate } from "./incident-format";

interface RecentIncidentBannerProps {
  /** Calendar date (`YYYY-MM-DD`) of the most recent in-window incident. */
  occurredOn: string;
}

/**
 * Prominent warning shown near the top of a listing when a RECENT "got
 * glutened" incident exists — fresh harm is never buried beneath older
 * confirmations (ADR-007, domain.md → Trust Model: "Recent incidents flag the
 * summary").
 *
 * Accessibility: this is a `role="alert"` region carrying the `incident` safety
 * signal (warning-triangle icon + the "Recent incident" text label + colour) —
 * meaning never rests on colour alone (docs/agents/styling.md, NON-NEGOTIABLE).
 *
 * Kept as its own small, prop-only component so the same recent-incident cue can
 * be reused by the browse list-card signal that lands with issue #33 (the browse
 * list does not exist yet).
 */
export function RecentIncidentBanner({ occurredOn }: RecentIncidentBannerProps) {
  const relative = relativeIncidentDate(occurredOn);
  return (
    <div
      role="alert"
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
    </div>
  );
}
