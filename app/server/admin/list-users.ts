import { asc } from "drizzle-orm";
import { getDb } from "~/db/client";
import { users } from "~/db/schema";
import { requireCurrentRole } from "~/server/auth/guards";
import type { AdminUserSummary } from "./list-users.fn";

/**
 * Server-only logic behind the `listUsers` server fn (#142).
 *
 * The role-management UI needs to FIND the user it is about to promote/demote,
 * but the app had no admin user-directory until now. This is the minimal,
 * robust lookup the issue calls for: an admin-only directory of accounts,
 * returning just the fields the UI needs to render a row and target a role
 * change.
 *
 * Design choice (documented per the issue): we LIST all users rather than a
 * find-by-email box. At single-metro pilot scale the account set is small, so a
 * full ordered list is the simplest correct mechanism — no pagination cursor,
 * no partial-match search semantics, and the admin can eyeball the whole roster
 * (and current roles) at once. To keep the response bounded regardless, we cap
 * it at {@link USER_LIST_LIMIT}; if the pilot ever outgrows that cap, swap this
 * for a paginated/searched lookup (the server fn shape can stay the same).
 *
 * Exposure is deliberately MINIMAL: only `id`, `email`, `name`, `role` leave the
 * server — never `googleSub` (an auth identity anchor) or `avatarUrl`. Reading
 * is a plain `SELECT`; this never writes, so it needs no schema change.
 *
 * Auth is enforced SERVER-SIDE here, never trusted to the UI:
 * - {@link requireCurrentRole}`("admin")` throws `401` for an anonymous caller
 *   and `403` for any signed-in non-admin (a plain `user` OR a `moderator` —
 *   moderators get the flag queue, NOT the user directory). Only admins proceed.
 *
 * Lives in its own module (NOT the route-imported `list-users.fn.ts`) so its
 * `db`-bound imports never leak into the client bundle: the `.fn.ts` wrapper
 * references this only from inside its `createServerFn` handler, which the
 * bundler strips client-side. Mirrors `set-role.ts` / `admin-view.ts`.
 *
 * Server-only: imports `db` directly and `requireCurrentRole` transitively.
 */

/**
 * Upper bound on the returned directory. The pilot account set is far below
 * this; the cap simply guarantees a bounded response so the UI can never be
 * handed an unbounded list.
 */
export const USER_LIST_LIMIT = 500;

/**
 * List accounts for the admin role-management directory (admin-only). Order of
 * operations:
 * 1. {@link requireCurrentRole}`("admin")` — server-side gate (401 anon / 403 non-admin).
 * 2. `SELECT id, email, name, role FROM users ORDER BY email` (bounded by
 *    {@link USER_LIST_LIMIT}) — a stable, scannable roster.
 */
export async function listUsers(): Promise<AdminUserSummary[]> {
  await requireCurrentRole("admin");

  const db = getDb();

  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .orderBy(asc(users.email))
    .limit(USER_LIST_LIMIT);
}
