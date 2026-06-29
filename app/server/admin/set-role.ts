import { and, count, eq, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getDb } from "~/db/client";
import { type User, users } from "~/db/schema";
import { requireCurrentRole } from "~/server/auth/guards";

/**
 * Server-only role-management logic behind the `setUserRole` server fn (#16,
 * ADR-010).
 *
 * Admins may grant/revoke the `moderator` role on any account at any time
 * ("No reputation-gated powers ... roles are explicitly granted" — ADR-010 /
 * domain.md Roles). This is an ADR-010 security boundary, so the gate is
 * enforced SERVER-SIDE here, never trusted to the UI:
 *
 * - {@link requireCurrentRole}`("admin")` throws `401` for an anonymous caller
 *   and `403` for any signed-in non-admin (a plain `user` OR a `moderator` —
 *   moderators get the flag queue, NOT role management). Only admins proceed.
 *
 * The assignable role is deliberately restricted to `moderator | user`: an
 * admin grants the moderator role (set to `moderator`) or revokes it (set back
 * to `user`). This function intentionally CANNOT mint another admin — see the
 * first-admin seed note on `set-role.fn.ts`. Validation happens via Zod before
 * any DB work, so an out-of-range role (e.g. `"admin"`) or an empty `userId` is
 * rejected, not written.
 *
 * Targeting a non-existent user is a `404` rather than a silent no-op, so the
 * caller (and any future admin UI) gets a clear signal instead of a phantom
 * success.
 *
 * --- Last-admin guard + self-demotion policy (#127) ------------------------
 * Because this fn can demote ANY user (including an existing `admin`) down to
 * `moderator`/`user`, an unguarded demotion could strip admin from the LAST
 * admin and lock the app out of all role/settings management — recoverable only
 * via the out-of-band first-admin seed (see `set-role.fn.ts`). So before a
 * change that would REMOVE admin from a user who currently IS an admin, we count
 * the OTHER remaining admins; if that count is zero (this is the last admin),
 * the demotion is rejected with a `409 Conflict`. The count is only run on that
 * specific transition (admin → moderator/user) — moderator/user changes never
 * touch it. This is a count-then-update check: at single-metro pilot scale the
 * race window (two admins demoting the two last admins concurrently) is
 * negligible and out of scope, so we accept it rather than adding locking.
 *
 * Self-demotion policy: an admin MAY step down (demote themselves) — minimal
 * surprise, and ADR-010 already lets admins manage roles at runtime. The one
 * exception is the last-admin guard above: a sole admin cannot demote
 * themselves, because that path is exactly what would lock the app out of
 * administration. So self-demotion is allowed EXCEPT when you are the last
 * admin, which the same guard blocks (it does not special-case self — it simply
 * counts the OTHER admins, which is correct whether the target is you or
 * someone else).
 *
 * The auth gate lives on the {@link setRole} entry point rather than a separate
 * pure helper because, unlike `runCreateListing`, role management has no
 * intermediate logic worth isolating from the session plumbing — the gate IS
 * the boundary under test. Lives in its own module (NOT the route-imported
 * `set-role.fn.ts`) so its `db`-bound imports never leak into the client bundle.
 *
 * Server-only: imports `db` directly and `requireCurrentRole` transitively.
 */

/**
 * Validated input for {@link setRole}. `userId` is the target account; `role` is
 * the assignable subset (an admin grants `moderator` or revokes it back to
 * `user` — this fn never assigns `admin`).
 */
export const setRoleInputSchema = z.object({
  userId: z.string().trim().min(1, "userId is required"),
  role: z.enum(["moderator", "user"]),
});
export type SetRoleInput = z.infer<typeof setRoleInputSchema>;

/** What a successful role change reports back: the updated user row. */
export interface SetRoleResult {
  user: User;
}

/**
 * Set a user's role (admin-only). Order of operations:
 * 1. {@link requireCurrentRole}`("admin")` — server-side gate (401 anon / 403 non-admin).
 * 2. Zod-validate the input (assignable role restricted to `moderator | user`;
 *    `userId` is trimmed and rejects whitespace-only).
 * 3. Last-admin guard: if the target currently IS an admin (so this change would
 *    REMOVE admin), count the OTHER remaining admins; reject with `409` when that
 *    is zero (demoting the last admin would lock the app out of administration).
 * 4. `UPDATE users SET role = ... WHERE id = userId`, returning the row.
 * 5. Empty `returning` ⇒ no such user ⇒ `404`.
 */
export async function setRole(input: SetRoleInput): Promise<SetRoleResult> {
  await requireCurrentRole("admin");

  const { userId, role } = setRoleInputSchema.parse(input);

  const db = getDb();

  // Last-admin guard (#127): only relevant when this write would strip admin
  // from a user who currently holds it. Look the target up first; if they are an
  // admin, count the OTHER admins and refuse if none remain. The same check
  // covers self-demotion — a sole admin counting zero others cannot step down.
  const targetRows = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  const target = targetRows[0];

  if (target?.role === "admin") {
    const otherAdmins = await db
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.role, "admin"), ne(users.id, userId)));

    if ((otherAdmins[0]?.value ?? 0) === 0) {
      throw new HTTPException(409, {
        message: "Cannot demote the last remaining admin.",
      });
    }
  }

  const updated = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  const row = updated[0];
  if (!row) {
    throw new HTTPException(404, { message: "User not found." });
  }

  return { user: row };
}
