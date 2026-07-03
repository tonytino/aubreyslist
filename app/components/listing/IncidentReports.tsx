import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import type { Incident } from "~/db/schema";
import { removeIncident, submitIncident, updateIncident } from "~/server/incidents/incidents.fn";
import {
  INCIDENT_SEVERITIES,
  type IncidentSeverity,
  isRecentIncident,
  toCalendarDayString,
} from "~/trust/incident-recency";
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
  /**
   * Reference instant for the per-row "Recent" recency tag (AUB-131), resolved
   * once server-side and threaded down so SSR and client agree. Defaults to the
   * current time when omitted.
   */
  now?: Date | undefined;
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
export function IncidentReports({ listingId, incidents, viewerId, now }: IncidentReportsProps) {
  return (
    <div className="flex flex-col gap-4">
      <IncidentList listingId={listingId} incidents={incidents} viewerId={viewerId} now={now} />
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
  now,
}: {
  listingId: string;
  incidents: readonly Incident[];
  viewerId: string | null;
  now?: Date | undefined;
}) {
  if (incidents.length === 0) {
    return <p className="text-body-sm text-muted-foreground">No glutened reports yet.</p>;
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
          now={now}
        />
      ))}
    </ul>
  );
}

/**
 * Per-severity colour + tooltip for the incident SEVERITY tag (AUB-131).
 *
 * Severity is a yellow→orange→red scale (Mild → Moderate → Severe) and is the
 * coloured focus of a report row. It is NOT a safety signal — it grades how bad
 * ONE report was — so it uses the dedicated `--color-severity-*` tokens, not the
 * safety palette. Every tag pairs the colour with the warning-triangle icon AND
 * the visible text label, so meaning survives greyscale; the tooltip only adds a
 * supplementary gloss.
 */
const SEVERITY_TAG: Record<IncidentSeverity, { className: string; tip: string }> = {
  mild: {
    className: "bg-severity-mild-soft text-severity-mild border-severity-mild/35",
    tip: "Reporter-rated severity: mild reaction.",
  },
  moderate: {
    className: "bg-severity-moderate-soft text-severity-moderate border-severity-moderate/35",
    tip: "Reporter-rated severity: moderate reaction.",
  },
  severe: {
    className: "bg-severity-severe-soft text-severity-severe border-severity-severe/35",
    tip: "Reporter-rated severity: severe reaction.",
  },
};

/** The coloured severity tag — the far-right, highest-emphasis label in a row. */
function SeverityTag({ severity }: { severity: IncidentSeverity }) {
  const cfg = SEVERITY_TAG[severity];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`inline-flex cursor-help items-center gap-1 rounded-chip border px-2 py-0.5 text-caption font-bold uppercase tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring ${cfg.className}`}
        >
          <TriangleAlert aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
          {formatSeverity(severity)}
        </button>
      </TooltipTrigger>
      <TooltipContent>{cfg.tip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The "Recent" recency tag — intentionally LOW intensity (muted outline, no red)
 * so the coloured severity tag dominates the row. Shown only when the incident is
 * inside the recency window (it is what flags the listing at the top of the page).
 */
function RecencyTag() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex cursor-help items-center gap-1 rounded-chip border border-border bg-transparent px-2 py-0.5 text-caption font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          <Clock aria-hidden="true" className="size-3.5" />
          Recent
        </button>
      </TooltipTrigger>
      <TooltipContent>Reported within the recency window, so it flags the listing.</TooltipContent>
    </Tooltip>
  );
}

/** A single incident row: display + (for the owner) edit/retract controls. */
function IncidentItem({
  listingId,
  incident,
  isOwn,
  isSignedIn,
  now,
}: {
  listingId: string;
  incident: Incident;
  isOwn: boolean;
  isSignedIn: boolean;
  now?: Date | undefined;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const isRecent = isRecentIncident(incident.occurredOn, now ?? new Date());

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
          {/* Label order (AUB-131): date (left) · recency (muted) · severity
              (coloured, far-right). `mr-auto` on the date pushes the recency +
              severity group to the right so severity anchors the far edge. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-body-sm font-bold text-foreground">
              {formatIncidentDate(incident.occurredOn)}
            </span>
            {isRecent ? <RecencyTag /> : null}
            {incident.severity ? <SeverityTag severity={incident.severity} /> : null}
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
        {/* Right-aligned (AUB-131): `self-end` in the incident section's column
            flex anchors the CTA to the right edge, under the report list. */}
        <Button type="button" variant="destructive" className="self-end">
          Report an incident
        </Button>
      </DialogTrigger>
      {/* Don't auto-focus the first field on open: focusing the native date input
          pops its picker open, which reads as a confusing half-open state. Let the
          modal open calm; the diner engages the date field themselves. */}
      <DialogContent onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Report a glutened incident</DialogTitle>
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
