import { getCurrentUser } from "~/server/auth/current-user";
import { getSetting } from "~/server/settings";
import type { AdminView } from "./admin-view.fn";

/**
 * Server-only access-gate logic behind the `fetchAdminView` server fn.
 *
 * ADR-010: permissions are enforced server-side, not just in the UI. Rather
 * than throw the raw 401/403 from `requireCurrentRole`, this resolves the
 * caller and reports a typed `access` discriminator so the loader can:
 *
 * - `anonymous` → redirect to sign-in,
 * - `forbidden` → render the 403 / not-authorised UI,
 * - `moderator` / `admin` → render the shell, with section visibility derived
 *   from the role (admins see everything; moderators see only the queue).
 *
 * The guard reads the authoritative `users` row via {@link getCurrentUser};
 * the client never decides access for itself. The settings snapshot is fetched
 * only for admins — the only role that sees the settings section; the
 * intake-mode write is gated separately in `set-intake-mode`.
 *
 * Lives in its own module (not the route-imported `admin-view.fn.ts`) so its
 * server-only imports (`getCurrentUser`/`getSetting` → `db`) never leak into
 * the client bundle. Server-only.
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
