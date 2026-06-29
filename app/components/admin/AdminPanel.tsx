import { useMutation } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useId } from "react";
import type { AdminSettingsView } from "~/server/admin/admin-view.fn";
import { setIntakeMode } from "~/server/admin/set-intake-mode.fn";
import type { Role } from "~/server/auth/guards";
import type { IntakeMode } from "~/server/settings";
import { AdminSection } from "./AdminSection";
import { ModerationQueue } from "./ModerationQueue";
import { type AdminSectionId, visibleSections } from "./sections";

interface AdminPanelProps {
  /**
   * The viewer's role (already known to be moderator or admin). Named
   * `viewerRole` rather than `role` so the prop isn't mistaken for the ARIA
   * `role` attribute by the a11y linter.
   */
  viewerRole: Exclude<Role, "user">;
  /** Read-only settings snapshot, present for admins; `null` for moderators. */
  settings: AdminSettingsView | null;
}

/**
 * The admin-panel shell body (issue #38).
 *
 * Renders exactly the sections {@link visibleSections} grants the viewer's role
 * — admins get role management, app settings, and the moderation queue; a
 * moderator gets only the moderation queue. App settings (#24) now lets an admin
 * toggle the active listing-intake mode; role management (#16) is still a
 * "coming soon" placeholder and the moderation queue (#40) renders its real UI.
 *
 * The intake-mode toggle is convenience UI only: the `setIntakeMode` server fn
 * re-gates to admin (ADR-010) and validates the value server-side, so the
 * section being admin-only here (via {@link visibleSections}) is never the
 * access control — a moderator never reaches it, and even if they did the server
 * would 403.
 */
export function AdminPanel({ viewerRole, settings }: AdminPanelProps) {
  const sections = visibleSections(viewerRole);
  return (
    <div className="flex flex-col gap-section">
      {sections.map((id) => (
        <SectionFor key={id} id={id} settings={settings} />
      ))}
    </div>
  );
}

/** Maps a section id to its placeholder/read-only content. */
function SectionFor({
  id,
  settings,
}: {
  id: AdminSectionId;
  settings: AdminSettingsView | null;
}) {
  switch (id) {
    case "settings":
      return <SettingsSection settings={settings} />;
    case "roles":
      return (
        <AdminSection
          title="Role management"
          description="Promote or demote moderators here. Admins will be able to grant moderator status to any signed-in account."
          badge="Coming soon"
        />
      );
    case "moderation-queue":
      return (
        <AdminSection
          title="Moderation queue"
          description="Open flags on listings, claims, and incident reports awaiting review. Moderation actions land with issue #41."
        >
          <ModerationQueue />
        </AdminSection>
      );
  }
}

/**
 * Selectable listing-intake modes (ADR-008). Kept as a small client-safe list
 * here — the runtime `INTAKE_MODES` registry lives in the server-only settings
 * module (it imports `db`), so importing its VALUE would pull `db` into the
 * client bundle. The authoritative allow-list is still the registry: the
 * `setIntakeMode` server fn validates the submitted mode against `INTAKE_MODES`,
 * so this UI list can never widen the boundary. `satisfies` keeps each `value`
 * in lock-step with the `IntakeMode` union, so a drift fails to compile.
 */
const INTAKE_MODE_OPTIONS = [
  { value: "places", label: "Places (Google autocomplete)" },
  { value: "manual", label: "Manual entry form" },
] as const satisfies readonly { value: IntakeMode; label: string }[];

/**
 * App-settings section. Lets an admin TOGGLE the active intake mode (#24,
 * ADR-008) and shows the staleness window read-only. `settings` is `null` for
 * moderators, who never reach this section — but we render an honest empty state
 * rather than fabricate values, just in case.
 */
function SettingsSection({ settings }: { settings: AdminSettingsView | null }) {
  return (
    <AdminSection
      title="App settings"
      description="Runtime configuration. Flip the listing-intake mode if the Places API nears its limit — the manual form is always a safe fallback (ADR-008)."
    >
      {settings ? (
        <div className="mt-2 flex flex-col gap-3">
          <IntakeModeControl current={settings.intakeMode} />
          <SettingRow label="Staleness window" value={`${settings.stalenessMonths} months`} />
        </div>
      ) : (
        <p className="text-body-sm text-muted-foreground">Settings are not available.</p>
      )}
    </AdminSection>
  );
}

/**
 * Admin-only control to flip the active listing-intake mode (#24, ADR-008).
 *
 * A labelled `<select>` (accessible — the meaning is in the label + option text,
 * never colour) wired to the `setIntakeMode` server fn through a TanStack Query
 * `useMutation`. On success it invalidates the admin route loader
 * (`router.invalidate()`) so the displayed value refetches from the
 * authoritative `intake_mode` setting and the whole shell stays consistent.
 */
function IntakeModeControl({ current }: { current: string }) {
  const router = useRouter();
  const selectId = useId();

  const mutation = useMutation({
    mutationFn: (mode: IntakeMode) => setIntakeMode({ data: { mode } }),
    onSuccess: () => router.invalidate(),
  });

  return (
    <div className="flex flex-col gap-1 rounded-card border border-border bg-background p-3">
      <label
        htmlFor={selectId}
        className="text-caption font-medium uppercase tracking-wide text-muted-foreground"
      >
        Intake mode
      </label>
      <select
        id={selectId}
        value={current}
        disabled={mutation.isPending}
        onChange={(event) => mutation.mutate(event.target.value as IntakeMode)}
        className="mt-1 rounded-card border border-border bg-background px-3 py-2 text-body font-semibold text-foreground disabled:opacity-50"
      >
        {INTAKE_MODE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {mutation.isPending ? <p className="text-caption text-muted-foreground">Saving…</p> : null}
      {mutation.isError ? (
        <p role="alert" className="text-caption text-incident">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Could not update the intake mode. Please try again."}
        </p>
      ) : null}
    </div>
  );
}

/** One read-only setting as a labelled value pair. */
function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border bg-background p-3">
      <span className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-body font-semibold text-foreground">{value}</span>
    </div>
  );
}
