import { getCookie } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { type User, users } from "~/db/schema";
import { SESSION_COOKIE_NAME, readSessionCookieValue } from "./session";

/**
 * Server-only current-user accessor. Reads + verifies the sealed session cookie
 * and resolves it to the live `users` row, or `null` when there is no valid
 * session.
 *
 * `getCookie` (re-exported from `@tanstack/react-start/server`) resolves the
 * ambient h3 request event, so this works from any server function / loader
 * without threading the request through. The cookie carries only a user id; the
 * authoritative row (incl. role) is always re-read here, so the session can
 * never carry stale privileges.
 *
 * This module imports `db` and must stay server-only — call it from server
 * functions, never from client components.
 */
export async function getCurrentUser(): Promise<User | null> {
  const sealed = getCookie(SESSION_COOKIE_NAME);
  if (!sealed) {
    return null;
  }

  const payload = await readSessionCookieValue(sealed);
  if (!payload) {
    return null;
  }

  const user = await getDb().query.users.findFirst({
    where: eq(users.id, payload.userId),
  });
  return user ?? null;
}
