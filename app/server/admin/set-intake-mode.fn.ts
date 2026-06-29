import { createServerFn } from "@tanstack/react-start";
import { setIntakeModeInputSchema } from "./set-intake-mode";

/**
 * Client-callable intake-mode toggle server function (issue #24, ADR-008).
 *
 * The entry point the admin panel's settings section calls to flip the active
 * listing-intake mode (`places` <-> `manual`). Mirroring `set-role.fn.ts`, the
 * db-touching logic lives in the server-only `./set-intake-mode` module and is
 * referenced only from inside the `createServerFn` handler via a lazy
 * `import()`, so the bundler strips it (and its `db`-bound imports) out of the
 * client bundle. The input schema is type-only/runtime-safe to import here (it
 * derives its `mode` values from the settings registry's `INTAKE_MODES`, no
 * `db`), so it backs the `.validator`.
 *
 * Auth is enforced SERVER-SIDE inside `setIntakeMode`
 * (`requireCurrentRole("admin")`) — anonymous -> 401, any non-admin (including a
 * moderator) -> 403. Managing app settings is admin-only (`domain.md` Roles).
 */

export const setIntakeMode = createServerFn({ method: "POST" })
  .validator(setIntakeModeInputSchema)
  .handler(async ({ data }) => {
    // Imported lazily inside the handler so the server-only intake-mode logic
    // (and its `db`-bound deps) stays out of the client bundle.
    const { setIntakeMode: run } = await import("./set-intake-mode");
    return run(data);
  });
