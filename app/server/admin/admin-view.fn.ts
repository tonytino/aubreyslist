import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "~/server/auth/current-user";
import type { Role } from "~/server/auth/guards";
import { getSetting } from "~/server/settings";

/**
 * Server function backing the admin-panel shell (issue #38).
 *
 * The admin route is admin-only and must be gated SERVER-SIDE (ADR-010 —
 * "enforce permissions server-side ... not just in the UI"). Rather than throw
 * the raw 401/403 from `requireCurrentRole` (which a route loader can't easily
 * turn into the two different UX outcomes the issue asks for), this resolves the
 * caller and reports a small, typed `access` discriminator so the loader can:
 *
 * - `anonymous` → redirect to sign-in,
 * - `forbidden` → render the 403 / not-authorised UI,
 * - `moderator` / `admin` → render the shell, with section visibility derived
 *   from the role (admins see everything; moderators see only the queue).
 *
 * The guard decision still happens on the server (this function reads the
 * authoritative `users` row via {@link getCurrentUser}); the client never
 * decides access for itself. Settings are read-only here — the write/toggle UI
 * lands with #24 — and only fetched for admins, who are the only role that sees
 * the settings section.
 *
 * Server-only: imports `db` transitively through current-user/settings.
 */

/** Read-only snapshot of the app settings shown in the (admin-only) settings section. */
export interface AdminSettingsView {
  /** Current listing-intake mode (ADR-008). */
  intakeMode: string;
  /** Current staleness window, in months (ADR-007). */
  stalenessMonths: number;
}

/**
 * What the admin route loader gets back. `access` discriminates the three UX
 * outcomes; `role` and `settings` are present only when access is granted.
 */
export type AdminView =
  | { access: "anonymous" }
  | { access: "forbidden" }
  | { access: "granted"; role: Exclude<Role, "user">; settings: AdminSettingsView | null };

/**
 * Pure access-gate logic behind {@link fetchAdminView}, factored out of the
 * `createServerFn` handler so it can be unit-tested directly against mocked
 * collaborators (the client-callable wrapper below is a thin delegate). This is
 * the same plain-function seam the other server modules expose for testing
 * (e.g. `runCreateListing`).
 */
export async function resolveAdminView(): Promise<AdminView> {
  const user = await getCurrentUser();

  if (!user) {
    return { access: "anonymous" };
  }

  // Anyone below moderator may not see the panel at all.
  if (user.role === "user") {
    return { access: "forbidden" };
  }

  // Settings are admin-only data, so fetch them only for admins.
  const settings =
    user.role === "admin"
      ? {
          intakeMode: await getSetting("intake_mode"),
          stalenessMonths: await getSetting("staleness_months"),
        }
      : null;

  return { access: "granted", role: user.role, settings };
}

export const fetchAdminView = createServerFn({ method: "GET" }).handler(
  (): Promise<AdminView> => resolveAdminView()
);
