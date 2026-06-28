import { createServerFn } from "@tanstack/react-start";
import { setRoleInputSchema } from "./set-role";

/**
 * Client-callable role-management server function (issue #16, ADR-010).
 *
 * This is the entry point a future admin UI calls to grant/revoke the
 * `moderator` role (the admin UI itself lands with the admin panel in EPIC 6;
 * none ships here). Mirroring `admin-view.fn.ts`, the db-touching logic lives in
 * the server-only `./set-role` module and is referenced only from inside the
 * `createServerFn` handler via a lazy `import()`, so the bundler strips it (and
 * its `db`-bound imports) out of the client bundle. The input schema is
 * type-only/runtime-safe to import here (no `db`), so it backs the `.validator`.
 *
 * Auth is enforced SERVER-SIDE inside `setRole` (`requireCurrentRole("admin")`)
 * — anonymous → 401, any non-admin (including a moderator) → 403.
 *
 * --- First-admin seed (safe:human) ----------------------------------------
 * This function can grant `moderator` and revoke it back to `user`, but it
 * CANNOT mint an admin — its input role is restricted to `moderator | user`,
 * and it requires the caller to already be an admin. That is intentional: it
 * removes any in-app path to self-promotion to admin. Consequently the FIRST
 * admin (the repo owner, per ADR-010) must be seeded OUT-OF-BAND — a manual DB
 * update or seed script setting `users.role = 'admin'` on the owner's account
 * after they have signed in once. This is a one-time `safe:human` setup step
 * and deliberately not automated here.
 */

export const setUserRole = createServerFn({ method: "POST" })
  .validator(setRoleInputSchema)
  .handler(async ({ data }) => {
    // Imported lazily inside the handler so the server-only role logic (and its
    // `db`-bound deps) stays out of the client bundle.
    const { setRole } = await import("./set-role");
    return setRole(data);
  });
