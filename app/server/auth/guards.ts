import { HTTPException } from "hono/http-exception";
import type { User } from "~/db/schema";
import { getCurrentUser } from "./current-user";

/**
 * Server-side auth guards enforcing the open-read / gated-write rule (ADR-010,
 * domain.md "Roles & Permissions"): reads stay anonymous, but every mutating
 * server function or Hono route must reject unauthenticated — and, where noted,
 * under-privileged — callers.
 *
 * Two consumption styles share one core so the same policy backs both API
 * layers (see `docs/agents/api.md`):
 *
 * - **Hono routes** resolve the user from the request themselves (the auth
 *   routes read the sealed cookie via `hono/cookie`), then pass it to the
 *   *synchronous* {@link requireUser} / {@link requireRole} guards.
 * - **Server functions** can skip that plumbing with the *async* convenience
 *   wrappers {@link requireCurrentUser} / {@link requireCurrentRole}, which read
 *   the ambient session via {@link getCurrentUser} first.
 *
 * Failures throw an `HTTPException` (401/403). The Hono error handler in
 * `app/server/index.ts` passes it through verbatim with the right status; in a
 * server function it surfaces as a thrown error, so an anonymous (or
 * under-privileged) write never proceeds. This module imports `db` transitively
 * and must stay server-only.
 */

/** A guarded user is a non-null `users` row — the absence of `null` is the guarantee. */
export type AuthenticatedUser = User;

/** User roles in ascending privilege order — see ADR-010. */
export type Role = User["role"];

/**
 * Role hierarchy as a privilege rank: higher number ⇒ more privilege. A guard
 * for role X admits anyone whose rank is ≥ X's rank (admin > moderator > user),
 * so `requireRole("moderator")` also lets admins through.
 */
const ROLE_RANK: Record<Role, number> = {
  user: 0,
  moderator: 1,
  admin: 2,
};

/**
 * Require an authenticated user. Throws `401 Unauthorized` when `user` is
 * `null` (anonymous), otherwise returns the row narrowed to non-null so callers
 * get the authenticated user without a redundant null-check.
 *
 * Synchronous on purpose: the caller supplies the already-resolved user, which
 * is what lets both Hono routes and server functions reuse one guard.
 */
export function requireUser(user: User | null): AuthenticatedUser {
  if (!user) {
    throw new HTTPException(401, { message: "Authentication required." });
  }
  return user;
}

/**
 * Require an authenticated user holding at least `role` (per the
 * admin > moderator > user hierarchy). Throws `401` when anonymous and `403`
 * when signed in but under-privileged; otherwise returns the user.
 */
export function requireRole(role: Role, user: User | null): AuthenticatedUser {
  const authenticated = requireUser(user);
  if (ROLE_RANK[authenticated.role] < ROLE_RANK[role]) {
    throw new HTTPException(403, {
      message: `Requires ${role} privileges.`,
    });
  }
  return authenticated;
}

/**
 * Async convenience for server functions: resolve the ambient session via
 * {@link getCurrentUser}, then apply {@link requireUser}. Throws `401` when no
 * one is signed in.
 */
export async function requireCurrentUser(): Promise<AuthenticatedUser> {
  return requireUser(await getCurrentUser());
}

/**
 * Async convenience for server functions: resolve the ambient session, then
 * apply {@link requireRole}. Throws `401` when anonymous, `403` when
 * under-privileged.
 */
export async function requireCurrentRole(role: Role): Promise<AuthenticatedUser> {
  return requireRole(role, await getCurrentUser());
}
