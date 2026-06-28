import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SafetySignal } from "~/components/SafetySignal";
import type { Incident } from "~/db/schema";
import { removeIncident, submitIncident, updateIncident } from "~/server/incidents/incidents.fn";
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
  /**
   * The signed-in viewer's user id, or `null` when anonymous. Drives the
   * submission form gate AND the OWNER-ONLY edit/retract controls (#32): a
   * control renders only on an incident whose `userId` matches `viewerId`. This
   * is UX only — the writes are re-gated + ownership-checked server-side.
   */
  viewerId: string | null;
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
 *
 * Owners may edit or retract their OWN reports inline (issue #32). The controls
 * appear only on the viewer's own incidents; ownership is enforced server-side.
 */
export function IncidentReports({ listingId, incidents, viewerId }: IncidentReportsProps) {
  return (
    <div className="flex flex-col gap-4">
      <IncidentList listingId={listingId} incidents={incidents} viewerId={viewerId} />
      {viewerId !== null ? (
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
function IncidentList({
  listingId,
  incidents,
  viewerId,
}: {
  listingId: string;
  incidents: readonly Incident[];
  viewerId: string | null;
}) {
  if (incidents.length === 0) {
    return (
      <p className="text-body-sm text-muted-foreground">No “got glutened here” reports yet.</p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {incidents.map((incident) => (
        <IncidentItem
          key={incident.id}
          listingId={listingId}
          incident={incident}
          // Owner-only controls: render edit/retract iff the viewer owns this row.
          isOwn={viewerId !== null && viewerId === incident.userId}
        />
      ))}
    </ul>
  );
}

/** A single incident row: display + (for the owner) edit/retract controls. */
function IncidentItem({
  listingId,
  incident,
  isOwn,
}: {
  listingId: string;
  incident: Incident;
  isOwn: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <li className="flex flex-col gap-2 rounded-card border border-border bg-background p-gutter">
      {isEditing ? (
        <IncidentEditForm
          listingId={listingId}
          incident={incident}
          onDone={() => setIsEditing(false)}
        />
      ) : (
        <>
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
          {isOwn ? (
            <IncidentOwnerControls
              listingId={listingId}
              incident={incident}
              onEdit={() => setIsEditing(true)}
            />
          ) : null}
        </>
      )}
    </li>
  );
}

/** Edit + retract buttons for the owner, with confirm-before-delete UX. */
function IncidentOwnerControls({
  listingId,
  incident,
  onEdit,
}: {
  listingId: string;
  incident: Incident;
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const retract = useMutation({
    mutationFn: () => removeIncident({ data: { id: incident.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: incidentsQueryKey(listingId) });
    },
  });

  if (confirmingDelete) {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-body-sm text-foreground">
          Retract this report? This cannot be undone.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={retract.isPending}
            onClick={() => retract.mutate()}
            className="inline-flex items-center justify-center rounded-card bg-incident px-4 py-2 text-body-sm font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-50"
          >
            {retract.isPending ? "Retracting…" : "Yes, retract"}
          </button>
          <button
            type="button"
            disabled={retract.isPending}
            onClick={() => setConfirmingDelete(false)}
            className="inline-flex items-center justify-center rounded-card border border-border px-4 py-2 text-body-sm font-semibold text-foreground hover:bg-surface disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {retract.isError ? (
          <p role="alert" className="text-body-sm text-incident">
            {retract.error instanceof Error
              ? retract.error.message
              : "Could not retract the report. Please try again."}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={onEdit}
        className="text-body-sm font-medium underline underline-offset-4 hover:text-brand"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={() => setConfirmingDelete(true)}
        className="text-body-sm font-medium text-incident underline underline-offset-4 hover:opacity-90"
      >
        Retract
      </button>
    </div>
  );
}

/** A severity selection plus the "" sentinel meaning "not specified". */
type SeverityChoice = (typeof INCIDENT_SEVERITIES)[number] | "";

/** Inline form to edit an OWN incident's date/severity/note (#32). */
function IncidentEditForm({
  listingId,
  incident,
  onDone,
}: {
  listingId: string;
  incident: Incident;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [occurredOn, setOccurredOn] = useState(incident.occurredOn);
  const [severity, setSeverity] = useState<SeverityChoice>(incident.severity ?? "");
  const [note, setNote] = useState(incident.note ?? "");

  const save = useMutation({
    mutationFn: () =>
      updateIncident({
        data: {
          id: incident.id,
          occurredOn,
          severity: severity === "" ? undefined : severity,
          note: note || undefined,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: incidentsQueryKey(listingId) });
      onDone();
    },
  });

  const canSubmit = occurredOn.trim() !== "";

  return (
    <form
      aria-label="Edit incident"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          save.mutate();
        }
      }}
    >
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

      {save.isError ? (
        <p role="alert" className="text-body-sm text-incident">
          {save.error instanceof Error
            ? save.error.message
            : "Could not save the changes. Please try again."}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canSubmit || save.isPending}
          className="inline-flex items-center justify-center rounded-card bg-brand px-5 py-2.5 text-body font-semibold text-brand-foreground hover:bg-brand-strong disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          disabled={save.isPending}
          onClick={onDone}
          className="inline-flex items-center justify-center rounded-card border border-border px-5 py-2.5 text-body font-semibold text-foreground hover:bg-surface disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

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
