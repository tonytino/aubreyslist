import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";
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
} from "~/components/ui/dialog";
import type { AdminSettingsView } from "~/server/admin/admin-view.fn";
import type { AdminUserSummary } from "~/server/admin/list-users.fn";
import { setIntakeMode } from "~/server/admin/set-intake-mode.fn";
import { setUserRole } from "~/server/admin/set-role.fn";
import type { Role } from "~/server/auth/guards";
import type { IntakeMode } from "~/server/settings";
import { AdminSection } from "./AdminSection";
import { ModerationQueue } from "./ModerationQueue";
import { adminUsersQueryKey, adminUsersQueryOptions } from "./admin-users-query";
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
 * moderator gets only the moderation queue. App settings (#24) lets an admin
 * toggle the active listing-intake mode; role management (#142) lists accounts
 * and lets an admin grant/revoke the moderator role; the moderation queue (#40,
 * #41) renders its real UI.
 *
 * The intake-mode toggle and the role controls are convenience UI only: the
 * `setIntakeMode` / `setUserRole` server fns re-gate to admin (ADR-010) and
 * validate server-side, so the sections being admin-only here (via
 * {@link visibleSections}) is never the access control — a moderator never
 * reaches them, and even if they did the server would 403.
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
          description="Grant or revoke the moderator role for any signed-in account. Admins are seeded out-of-band and cannot be granted here."
        >
          <RoleManagement />
        </AdminSection>
      );
    case "moderation-queue":
      return (
        <AdminSection
          title="Moderation queue"
          description="Open flags on listings, claims, and incident reports awaiting review. Each flagged item has Dismiss, Hide, and Remove actions for triage."
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
        <div className="flex flex-col gap-3">
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
    <div className="flex flex-col gap-1 rounded-card border border-border bg-muted p-3">
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
        <p role="alert" className="text-caption text-destructive">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Could not update the intake mode. Please try again."}
        </p>
      ) : null}
    </div>
  );
}

/** The role an admin may assign via the UI (mirrors `setRoleInputSchema`'s `role`). */
type AssignableRole = "moderator" | "user";

/** Human-readable label for each role shown in the directory. */
const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  moderator: "Moderator",
  user: "User",
};

/**
 * Admin-only role-management section (#142).
 *
 * Lists every account (via the admin-only `listUsers` server fn, read through
 * TanStack Query) with its current role, and — for non-admin accounts — a
 * control to grant or revoke the `moderator` role through the existing
 * `setUserRole` server fn (`useMutation`). On success the directory query is
 * invalidated so the row's displayed role refetches from the authoritative
 * `users` table.
 *
 * This UI is convenience only: `listUsers` and `setUserRole` both re-run
 * `requireCurrentRole("admin")` server-side (ADR-010), so a moderator never
 * reaching this section is not the access control — the server is.
 *
 * Admins themselves expose NO role control: this fn cannot mint admins, and the
 * one demotion the server forbids — stripping the last admin — surfaces as an
 * inline 409 alert ("Cannot demote the last remaining admin.") rather than
 * crashing.
 */
function RoleManagement() {
  const usersQuery = useQuery(adminUsersQueryOptions());

  if (usersQuery.isPending) {
    return <p className="text-body-sm text-muted-foreground">Loading accounts…</p>;
  }

  if (usersQuery.isError) {
    return (
      <p role="alert" className="text-body-sm text-destructive">
        {usersQuery.error instanceof Error
          ? usersQuery.error.message
          : "Could not load the user directory. Please try again."}
      </p>
    );
  }

  const accounts = usersQuery.data;

  if (accounts.length === 0) {
    return <p className="text-body-sm text-muted-foreground">No accounts yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {accounts.map((account) => (
        <li key={account.id}>
          <RoleRow account={account} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One directory row: the account's name/email, its current role (shown as a
 * TEXT `Badge`, never colour alone), and — for non-admin accounts — a
 * grant/revoke control gated behind a confirmation dialog.
 */
function RoleRow({ account }: { account: AdminUserSummary }) {
  const queryClient = useQueryClient();
  const errorId = useId();

  const mutation = useMutation({
    mutationFn: (role: AssignableRole) => setUserRole({ data: { userId: account.id, role } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminUsersQueryKey }),
  });

  return (
    <article className="flex flex-col gap-2 rounded-card border border-border bg-muted p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-body font-semibold text-foreground">{account.name}</span>
          <span className="text-caption text-muted-foreground">{account.email}</span>
        </div>
        <Badge variant="secondary">{ROLE_LABEL[account.role]}</Badge>
      </div>

      {account.role === "admin" ? (
        // An admin's role can't be changed here: this fn can't mint admins, and
        // admins are seeded out-of-band (see set-role.fn.ts).
        <p className="text-caption text-muted-foreground">
          Admins are seeded out-of-band and can't be changed here.
        </p>
      ) : (
        // A grant/revoke control gated behind a confirmation dialog (the dialog
        // is UI-only; the server fn still re-gates to admin per ADR-010). Only
        // non-admin accounts reach here, so the role flip is unambiguous: a
        // `user` is promoted to `moderator`, a `moderator` is demoted to `user`.
        <RoleChangeControl
          account={account}
          pending={mutation.isPending}
          errorId={mutation.isError ? errorId : undefined}
          onConfirm={(role) => mutation.mutate(role)}
        />
      )}

      {mutation.isSuccess ? (
        <output className="text-caption text-foreground">Role updated for {account.name}.</output>
      ) : null}
      {mutation.isError ? (
        <p id={errorId} role="alert" className="text-caption text-destructive">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Could not update the role. Please try again."}
        </p>
      ) : null}
    </article>
  );
}

/**
 * The grant/revoke trigger + confirmation dialog for one non-admin account.
 *
 * Role changes are sensitive (granting moderator powers, or stripping them), so
 * the actual `setUserRole` mutation only fires after the admin explicitly
 * confirms in a `Dialog` that names what will happen. The dialog GATES the click
 * — it is not the authorization: `setUserRole` re-runs `requireCurrentRole`
 * server-side regardless (ADR-010). Revoking (demoting to `user`) uses the
 * `destructive` confirm variant; granting moderator uses the default variant.
 */
function RoleChangeControl({
  account,
  pending,
  errorId,
  onConfirm,
}: {
  account: AdminUserSummary;
  pending: boolean;
  errorId: string | undefined;
  onConfirm: (role: AssignableRole) => void;
}) {
  const [open, setOpen] = useState(false);
  // Only non-admin accounts reach here, so the current role is one of the two
  // assignable roles; the flip is its opposite.
  const isModerator = account.role === "moderator";
  const nextRole: AssignableRole = isModerator ? "user" : "moderator";
  const triggerLabel = isModerator ? "Revoke moderator" : "Make moderator";

  function handleConfirm() {
    onConfirm(nextRole);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="sm"
        variant={isModerator ? "destructive" : "outline"}
        disabled={pending}
        aria-describedby={errorId}
        aria-label={`Set role for ${account.name}`}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>
      {pending ? <p className="text-caption text-muted-foreground">Saving…</p> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isModerator
              ? `Revoke moderator from ${account.name}?`
              : `Make ${account.name} a moderator?`}
          </DialogTitle>
          <DialogDescription>
            {isModerator
              ? `${account.name} (${account.email}) will lose access to the moderation queue and all moderation actions. They will become a regular user.`
              : `${account.name} (${account.email}) will be able to view the moderation queue and hide, remove, or dismiss any content. Only grant this to people you trust.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant={isModerator ? "destructive" : "default"}
            onClick={handleConfirm}
          >
            {triggerLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One read-only setting as a labelled value pair. */
function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border bg-muted p-3">
      <span className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-body font-semibold text-foreground">{value}</span>
    </div>
  );
}
