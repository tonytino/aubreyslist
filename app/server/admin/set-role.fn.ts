import { createServerFn } from "@tanstack/react-start";
import { setRoleInputSchema } from "./set-role";

/**
 * Client-callable role-management server function (ADR-010).
 *
 * Entry point the admin UI calls to grant/revoke the `moderator` role. The
 * db-touching logic lives in the server-only `./set-role` module, referenced
 * only from inside the `createServerFn` handler via a lazy `import()`, so the
 * bundler strips it (and its `db`-bound imports) out of the client bundle.
 * The input schema is runtime-safe to import here (no `db`), so it backs the
 * `.validator`.
 *
 * Auth is enforced server-side inside `setRole` (`requireCurrentRole("admin")`)
 * — anonymous → 401, any non-admin (including a moderator) → 403.
 *
 * First-admin seed (safe:human): this function can grant `moderator` and
 * revoke it back to `user`, but it cannot mint an admin — its input role is
 * restricted to `moderator | user`, and the caller must already be an admin.
 * That removes any in-app path to self-promotion to admin. The first admin
 * (the repo owner, per ADR-010) must be seeded out-of-band — a manual DB
 * update or seed script after they have signed in once. A one-time
 * `safe:human` setup step, deliberately not automated here.
 */

export const setUserRole = createServerFn({ method: "POST" })
  .validator(setRoleInputSchema)
  .handler(async ({ data }) => {
    // Imported lazily inside the handler so the server-only role logic (and its
    // `db`-bound deps) stays out of the client bundle.
    const { setRole } = await import("./set-role");
    return setRole(data);
  });
