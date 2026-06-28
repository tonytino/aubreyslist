import { eq } from "drizzle-orm";
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
  userId: z.string().min(1, "userId is required"),
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
 * 2. Zod-validate the input (assignable role restricted to `moderator | user`).
 * 3. `UPDATE users SET role = ... WHERE id = userId`, returning the row.
 * 4. Empty `returning` ⇒ no such user ⇒ `404`.
 */
export async function setRole(input: SetRoleInput): Promise<SetRoleResult> {
  await requireCurrentRole("admin");

  const { userId, role } = setRoleInputSchema.parse(input);

  const db = getDb();
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
