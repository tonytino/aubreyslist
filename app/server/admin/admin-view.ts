import { getCurrentUser } from "~/server/auth/current-user";
import { getSetting } from "~/server/settings";
import type { AdminView } from "./admin-view.fn";

/**
 * Server-only access-gate logic behind the `fetchAdminView` server fn (#38).
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
 * The guard decision happens here on the server (reading the authoritative
 * `users` row via {@link getCurrentUser}); the client never decides access for
 * itself. Settings are read-only here — the write/toggle UI lands with #24 —
 * and only fetched for admins, who are the only role that sees the settings
 * section.
 *
 * This lives in its own module (NOT the route-imported `admin-view.fn.ts`) so
 * its server-only imports (`getCurrentUser`/`getSetting` → `db`) never leak
 * into the client bundle: the `.fn.ts` wrapper references this only from inside
 * its `createServerFn` handler, which the bundler strips client-side. Splitting
 * the pure logic out this way also lets it be unit-tested directly against
 * mocked collaborators, the same seam other server modules expose for testing
 * (e.g. `runCreateListing`).
 *
 * Server-only: imports `db` transitively through current-user/settings.
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
