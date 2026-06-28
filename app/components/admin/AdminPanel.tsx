import type { AdminSettingsView } from "~/server/admin/admin-view.fn";
import type { Role } from "~/server/auth/guards";
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
 * moderator gets only the moderation queue. Every section is a clearly-labelled
 * placeholder (no fabricated data): role management (#16) and the moderation
 * queue (#40) are "coming soon", and app settings (#24) shows the *current*
 * values read-only until the write/toggle UI lands.
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
 * App-settings section. Renders the CURRENT values read-only (issue #38); the
 * write/toggle UI lands with #24. `settings` is `null` for moderators, who
 * never reach this section — but we render an honest empty state rather than
 * fabricate values, just in case.
 */
function SettingsSection({ settings }: { settings: AdminSettingsView | null }) {
  return (
    <AdminSection
      title="App settings"
      description="Current runtime configuration. Editing these lands with issue #24; for now they are shown read-only."
      badge="Read-only"
    >
      {settings ? (
        <dl className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SettingRow label="Intake mode" value={settings.intakeMode} />
          <SettingRow label="Staleness window" value={`${settings.stalenessMonths} months`} />
        </dl>
      ) : (
        <p className="text-body-sm text-muted-foreground">Settings are not available.</p>
      )}
    </AdminSection>
  );
}

/** One read-only setting as a labelled value pair. */
function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border bg-background p-3">
      <dt className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-body font-semibold text-foreground">{value}</dd>
    </div>
  );
}
