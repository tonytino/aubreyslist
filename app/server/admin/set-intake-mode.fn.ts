import { createServerFn } from "@tanstack/react-start";
import { setIntakeModeInputSchema } from "./set-intake-mode";

/**
 * Client-callable intake-mode toggle server function (ADR-008).
 *
 * Entry point the admin panel's settings section calls to flip the intake mode
 * (`places` <-> `manual`). The db-touching logic lives in the server-only
 * `./set-intake-mode` module, referenced only from inside the `createServerFn`
 * handler via a lazy `import()`, so the bundler strips it (and its `db`-bound
 * imports) out of the client bundle. The input schema is runtime-safe to
 * import here (no `db`), so it backs the `.validator`.
 *
 * Auth is enforced server-side inside `setIntakeMode`
 * (`requireCurrentRole("admin")`) — anonymous -> 401, any non-admin (including
 * a moderator) -> 403. Managing app settings is admin-only (`domain.md` Roles).
 */

export const setIntakeMode = createServerFn({ method: "POST" })
  .validator(setIntakeModeInputSchema)
  .handler(async ({ data }) => {
    // Imported lazily inside the handler so the server-only intake-mode logic
    // (and its `db`-bound deps) stays out of the client bundle.
    const { setIntakeMode: run } = await import("./set-intake-mode");
    return run(data);
  });
