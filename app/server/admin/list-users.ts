import { asc } from "drizzle-orm";
import { getDb } from "~/db/client";
import { users } from "~/db/schema";
import { requireCurrentRole } from "~/server/auth/guards";
import type { AdminUserSummary } from "./list-users.fn";

/**
 * Server-only logic behind the `listUsers` server fn: the admin-only account
 * directory backing the role-management UI.
 *
 * Lists all users rather than a find-by-email box: at pilot scale the account
 * set is small, so a full ordered list is the simplest correct mechanism. The
 * response is capped at {@link USER_LIST_LIMIT}; if the pilot outgrows that,
 * swap in a paginated/searched lookup (the server fn shape can stay).
 *
 * Exposure is minimal: only `id`, `email`, `name`, `role` leave the server —
 * never `googleSub` (an auth identity anchor) or `avatarUrl`.
 *
 * Auth is enforced server-side, never trusted to the UI:
 * {@link requireCurrentRole}`("admin")` throws `401` anonymous / `403` any
 * signed-in non-admin (moderators get the flag queue, not the directory).
 *
 * Lives in its own module (not the route-imported `list-users.fn.ts`) so its
 * `db`-bound imports never leak into the client bundle. Server-only.
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
