import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SafetySignal } from "~/components/SafetySignal";
import type { Incident } from "~/db/schema";
import { submitIncident } from "~/server/incidents/incidents.fn";
import { INCIDENT_SEVERITIES } from "~/trust/incident-recency";
import { formatIncidentDate, formatSeverity } from "./incident-format";

/** Query key for a listing's incident list — shared so a write can invalidate it. */
export function incidentsQueryKey(listingId: string): readonly [string, string] {
  return ["incidents", listingId];
}

interface IncidentReportsProps {
  listingId: string;
  /** A listing's incidents, most-recent first (from the route loader / query). */
  incidents: readonly Incident[];
  /** Whether the visitor is signed in — gates the submission form (UX only; the
   * write is gated again server-side). */
  isSignedIn: boolean;
}

/**
 * The "Incident reports" body: the list of a listing's "got glutened" reports
 * (most-recent first, with dates + optional severity/note) plus the submission
 * form for signed-in visitors. Rendered inside the listing-detail
 * `TrustPlaceholder` slot (issue #30).
 *
 * Recent harm is also surfaced prominently at the top of the page via
 * `RecentIncidentBanner`; this section is the full, always-visible evidence
 * underneath (ADR-007: the summary is a roll-up of visible evidence).
 */
export function IncidentReports({ listingId, incidents, isSignedIn }: IncidentReportsProps) {
  return (
    <div className="flex flex-col gap-4">
      <IncidentList incidents={incidents} />
      {isSignedIn ? (
        <IncidentForm listingId={listingId} />
      ) : (
        <p className="text-body-sm text-muted-foreground">
          <a href="/api/auth/google" className="underline underline-offset-4">
            Sign in
          </a>{" "}
          to report an incident.
        </p>
      )}
    </div>
  );
}

/** The most-recent-first list of incidents, or an honest empty state. */
function IncidentList({ incidents }: { incidents: readonly Incident[] }) {
  if (incidents.length === 0) {
    return (
      <p className="text-body-sm text-muted-foreground">No “got glutened here” reports yet.</p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {incidents.map((incident) => (
        <li
          key={incident.id}
          className="flex flex-col gap-1 rounded-card border border-border bg-background p-gutter"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body-sm font-medium text-foreground">
              {formatIncidentDate(incident.occurredOn)}
            </span>
            {incident.severity ? (
              <span className="rounded-chip bg-incident-soft px-2.5 py-1 text-caption font-medium text-incident">
                {formatSeverity(incident.severity)}
              </span>
            ) : null}
          </div>
          {incident.note ? (
            <p className="text-body-sm text-muted-foreground">{incident.note}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** A severity selection plus the "" sentinel meaning "not specified". */
type SeverityChoice = (typeof INCIDENT_SEVERITIES)[number] | "";

/** The login-gated submission form. */
function IncidentForm({ listingId }: { listingId: string }) {
  const queryClient = useQueryClient();
  const [occurredOn, setOccurredOn] = useState("");
  const [severity, setSeverity] = useState<SeverityChoice>("");
  const [note, setNote] = useState("");

  const report = useMutation({
    mutationFn: () =>
      submitIncident({
        data: {
          listingId,
          occurredOn,
          // "" means "no severity"; otherwise it is a valid enum member.
          severity: severity === "" ? undefined : severity,
          note: note || undefined,
        },
      }),
    onSuccess: () => {
      setOccurredOn("");
      setSeverity("");
      setNote("");
      queryClient.invalidateQueries({ queryKey: incidentsQueryKey(listingId) });
    },
  });

  const canSubmit = occurredOn.trim() !== "";

  return (
    <form
      aria-label="Report an incident"
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-gutter"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          report.mutate();
        }
      }}
    >
      <div className="flex items-center gap-2">
        <SafetySignal state="incident" />
        <span className="text-body-sm font-medium text-foreground">
          Report a “got glutened here” incident
        </span>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-body-sm font-medium text-foreground">
          Date it happened <span className="text-incident">*</span>
        </span>
        <input
          type="date"
          required
          value={occurredOn}
          onChange={(event) => setOccurredOn(event.target.value)}
          className="rounded-card border border-border bg-background px-3 py-2 text-body text-foreground"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-body-sm font-medium text-foreground">Severity (optional)</span>
        <select
          value={severity}
          onChange={(event) => setSeverity(event.target.value as SeverityChoice)}
          className="rounded-card border border-border bg-background px-3 py-2 text-body text-foreground"
        >
          <option value="">Not specified</option>
          {INCIDENT_SEVERITIES.map((value) => (
            <option key={value} value={value}>
              {formatSeverity(value)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-body-sm font-medium text-foreground">What happened (optional)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={2000}
          className="rounded-card border border-border bg-background px-3 py-2 text-body text-foreground"
        />
      </label>

      {report.isError ? (
        <p role="alert" className="text-body-sm text-incident">
          {report.error instanceof Error
            ? report.error.message
            : "Could not submit the report. Please try again."}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit || report.isPending}
        className="inline-flex items-center justify-center rounded-card bg-brand px-5 py-2.5 text-body font-semibold text-brand-foreground hover:bg-brand-strong disabled:opacity-50"
      >
        {report.isPending ? "Submitting…" : "Submit report"}
      </button>
    </form>
  );
}
