import { createServerFn } from "@tanstack/react-start";
import type { Role } from "~/server/auth/guards";

/**
 * Client-callable admin user-directory server function (issue #142).
 *
 * The entry point the role-management section calls to list accounts it can
 * promote/demote. Mirroring `admin-view.fn.ts` / `set-role.fn.ts`, the
 * db-touching logic lives in the server-only `./list-users` module and is
 * referenced only from inside the `createServerFn` handler via a lazy
 * `import()`, so the bundler strips it (and its `db`-bound imports) out of the
 * client bundle.
 *
 * The exported `AdminUserSummary` type is safe to import from client code
 * (type-only, erased at build time) and is consumed by the `AdminPanel`
 * role-management UI and its query options.
 *
 * Auth is enforced SERVER-SIDE inside `listUsers` (`requireCurrentRole("admin")`)
 * — anonymous → 401, any non-admin (including a moderator) → 403. The directory
 * is admin-only data; UI gating is never the control.
 */

/** A single directory row — the minimal fields the role-management UI needs. */
export interface AdminUserSummary {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export const listUsers = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminUserSummary[]> => {
    // Imported lazily inside the handler so the server-only directory logic (and
    // its `db`-bound deps) stays out of the client bundle.
    const { listUsers: run } = await import("./list-users");
    return run();
  }
);
