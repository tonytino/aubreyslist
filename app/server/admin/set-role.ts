import { and, count, eq, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getDb } from "~/db/client";
import { type User, users } from "~/db/schema";
import { requireCurrentRole } from "~/server/auth/guards";

/**
 * Server-only role-management logic behind the `setUserRole` server fn
 * (ADR-010).
 *
 * ADR-010 security boundary — the gate is enforced server-side, never trusted
 * to the UI: {@link requireCurrentRole}`("admin")` throws `401` for anonymous
 * and `403` for any signed-in non-admin (moderators get the flag queue, not
 * role management).
 *
 * The assignable role is restricted to `moderator | user`: this function
 * cannot mint another admin — see the first-admin seed note on
 * `set-role.fn.ts`. Zod validates before any DB work. Targeting a non-existent
 * user is a `404`, not a silent no-op.
 *
 * Last-admin guard: before a change that would remove admin from a user who
 * currently holds it, count the other remaining admins; if zero, reject with
 * `409 Conflict` — demoting the last admin would lock the app out of all
 * role/settings management, recoverable only via the out-of-band first-admin
 * seed. Count-then-update: at pilot scale the race window (two admins demoting
 * the two last admins concurrently) is accepted rather than adding locking.
 *
 * Self-demotion: an admin may step down, except when they are the last admin —
 * the same guard blocks it (it counts the other admins, which is correct
 * whether the target is you or someone else).
 *
 * Lives in its own module (not the route-imported `set-role.fn.ts`) so its
 * `db`-bound imports never leak into the client bundle. Server-only.
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
 * 3. Last-admin guard: if the target is currently an admin, count the other
 *    remaining admins; reject with `409` when that is zero.
 * 4. `UPDATE users SET role = ... WHERE id = userId`, returning the row.
 * 5. Empty `returning` ⇒ no such user ⇒ `404`.
 */
export async function setRole(input: SetRoleInput): Promise<SetRoleResult> {
  await requireCurrentRole("admin");

  const { userId, role } = setRoleInputSchema.parse(input);

  const db = getDb();

  // Last-admin guard: only relevant when this write would strip admin from a
  // user who currently holds it. Look the target up first; if they are an
  // admin, count the other admins and refuse if none remain. The same check
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
