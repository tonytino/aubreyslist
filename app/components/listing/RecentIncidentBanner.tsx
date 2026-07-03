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
 * Accessibility: a labelled `<output>` polite live region (implicit
 * `role="status"`, `aria-live="polite"`) carrying the `incident` safety signal
 * (warning-triangle icon + the "Recent incident" text label + colour) — meaning
 * never rests on colour alone (docs/agents/styling.md, NON-NEGOTIABLE). This is a
 * SAFETY-CRITICAL "recent harm" warning, so it is an ARIA live region (not a
 * passive `role="region"` landmark) — assistive tech announces it when it
 * appears, including when it materialises post-navigation/filter on the client.
 * We use a polite `status` rather than an assertive `alert` because it is also
 * SSR'd on load (present, not an interruptive live update); `alert` stays
 * reserved for the post-submit error message in the report form. `<output>` is
 * the project's semantic role=status element (see listings.index.tsx,
 * FlagControl.tsx), so no explicit `role` is needed.
 *
 * The pill itself carries ONLY the plain "Recent incident" label (default
 * `SafetySignal` label) with `whitespace-nowrap` — the relative recency ("2 days
 * ago") used to be interpolated into the pill text ("Recent incident · 2 days
 * ago"), which wrapped to three lines on mobile and read as broken
 * (screenshot-confirmed owner feedback). The recency now lives in the body copy
 * instead, alongside the absolute date, where it wraps naturally. Because the
 * whole `<output>` is one polite live region, screen readers still announce
 * BOTH the incident (pill) and its recency (body sentence) together — the
 * accessibility contract is preserved, just relocated.
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
    // `<output>` is the project's semantic polite-live-region element (implicit
    // role="status"); used here so the warning is announced when it appears. We
    // keep aria-live explicit and add an accessible name for the announcement.
    <output
      aria-live="polite"
      aria-label="Recent incident warning"
      className="flex flex-col gap-2 rounded-card border border-incident/30 border-l-4 border-l-incident bg-incident-soft p-gutter sm:flex-row sm:items-center sm:gap-3"
    >
      {/* Plain "Recent incident" label only — `whitespace-nowrap` keeps the pill
          on a single line at every width; the recency detail moved to the body
          sentence below, which wraps naturally instead of breaking the pill. */}
      <SafetySignal state="incident" variant="solid" className="self-start whitespace-nowrap" />
      <p className="text-body-sm text-incident">
        A diner reported getting glutened here on {formatIncidentDate(occurredOn)} — {relative}.
        Recent reports are shown regardless of older confirmations — check the incident reports
        below before you decide.
      </p>
    </output>
  );
}
