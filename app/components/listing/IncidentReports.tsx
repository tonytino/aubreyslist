import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import type { Incident } from "~/db/schema";
import { removeIncident, submitIncident, updateIncident } from "~/server/incidents/incidents.fn";
import { INCIDENT_SEVERITIES, toCalendarDayString } from "~/trust/incident-recency";
import { FlagControl } from "./FlagControl";
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
        <ReportIncidentDialog listingId={listingId} />
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
          // Any signed-in viewer can flag a report (#39); the server re-gates.
          isSignedIn={viewerId !== null}
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
  isSignedIn,
}: {
  listingId: string;
  incident: Incident;
  isOwn: boolean;
  isSignedIn: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-card p-gutter text-card-foreground shadow-sm">
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
              <Badge className="rounded-chip border-incident/30 bg-incident-soft text-incident">
                {formatSeverity(incident.severity)}
              </Badge>
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
          {/* Flag this report as inappropriate/spam/wrong (#39). Login-gated;
              the control renders nothing for anonymous viewers and the server
              re-gates regardless. */}
          <FlagControl
            target="incident"
            incidentId={incident.id}
            isSignedIn={isSignedIn}
            label="Flag report"
          />
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
      toast.success("Report retracted");
    },
    onError: () => {
      toast.error("Could not retract the report. Please try again.");
    },
  });

  if (confirmingDelete) {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-body-sm text-foreground">
          Retract this report? This cannot be undone.
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={retract.isPending}
            onClick={() => retract.mutate()}
          >
            {retract.isPending ? "Retracting…" : "Yes, retract"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={retract.isPending}
            onClick={() => setConfirmingDelete(false)}
          >
            Cancel
          </Button>
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
    <div className="flex gap-1">
      <Button type="button" size="sm" variant="link" className="px-0" onClick={onEdit}>
        Edit
      </Button>
      <Button
        type="button"
        size="sm"
        variant="link"
        className="px-0 text-incident"
        onClick={() => setConfirmingDelete(true)}
      >
        Retract
      </Button>
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
      toast.success("Report updated");
    },
    onError: () => {
      toast.error("Could not save the changes. Please try again.");
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
        <Button type="submit" disabled={!canSubmit || save.isPending}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * The `YYYY-MM-DD` default for the "date it happened" field: the viewer's LOCAL
 * calendar day (the natural "it happened today" default), CLAMPED so it never
 * exceeds the UTC calendar day.
 *
 * Why the clamp: the report schema's no-future rule is UTC-based
 * (`occurredOn <= todayUtcMidnight()`). A browser AHEAD of UTC (positive offset,
 * e.g. Asia/Tokyo in the morning) has a local calendar day that can be UTC-
 * *tomorrow*, which the server would reject as "in the future". Taking the
 * earlier of {local day, UTC day} keeps the friendly local default where it's
 * valid (incl. the Americas / Denver pilot, always behind UTC) and falls back to
 * the UTC ceiling exactly when the local day would be rejected. `YYYY-MM-DD`
 * strings compare chronologically, so the min is a plain string comparison.
 */
export function todayForDateInput(now: Date = new Date()): string {
  const localDay = toCalendarDayString(now);
  const utcDay = now.toISOString().slice(0, 10);
  return localDay < utcDay ? localDay : utcDay;
}

/**
 * The login-gated report flow, gated behind a button that opens a modal.
 *
 * The submission form lives inside a `Dialog` rather than being always-expanded
 * on the page: a fully-open form reads as an active incident/alert until you
 * realise it is just an empty form, which is visual noise on an otherwise calm
 * listing page. The trigger button keeps the affordance discoverable while the
 * form stays out of the way until a diner actually wants to file a report.
 */
function ReportIncidentDialog({ listingId }: { listingId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" className="self-start">
          Report an incident
        </Button>
      </DialogTrigger>
      {/* Don't auto-focus the first field on open: focusing the native date input
          pops its picker open, which reads as a confusing half-open state. Let the
          modal open calm; the diner engages the date field themselves. */}
      <DialogContent onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Report a “got glutened here” incident</DialogTitle>
          <DialogDescription>
            Share when it happened so other diners are warned. A recent report flags this listing at
            the top of the page.
          </DialogDescription>
        </DialogHeader>
        <IncidentForm listingId={listingId} onSuccess={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** The login-gated submission form, rendered inside the report modal. */
function IncidentForm({ listingId, onSuccess }: { listingId: string; onSuccess: () => void }) {
  const queryClient = useQueryClient();
  // Default to today (the common case — you report a reaction the day it happens),
  // pre-filled but editable. Clamped to the UTC ceiling so it can never be a date
  // the server's no-future rule rejects — see todayForDateInput.
  const [occurredOn, setOccurredOn] = useState(todayForDateInput);
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
      setOccurredOn(todayForDateInput());
      setSeverity("");
      setNote("");
      queryClient.invalidateQueries({ queryKey: incidentsQueryKey(listingId) });
      toast.success("Incident reported");
      onSuccess();
    },
    onError: () => {
      toast.error("Could not submit the report. Please try again.");
    },
  });

  const canSubmit = occurredOn.trim() !== "";

  return (
    <form
      aria-label="Report an incident"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          report.mutate();
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

      {report.isError ? (
        <p role="alert" className="text-body-sm text-incident">
          {report.error instanceof Error
            ? report.error.message
            : "Could not submit the report. Please try again."}
        </p>
      ) : null}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={report.isPending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!canSubmit || report.isPending}>
          {report.isPending ? "Submitting…" : "Submit report"}
        </Button>
      </DialogFooter>
    </form>
  );
}
