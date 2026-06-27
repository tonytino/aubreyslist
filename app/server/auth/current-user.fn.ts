import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "./current-user";

/**
 * Public-safe view of the signed-in user for the client. We narrow the DB row
 * to just the fields the UI needs, so the server function's surface stays
 * intentional rather than leaking the whole row shape.
 */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: "admin" | "moderator" | "user";
}

/**
 * Server function the client calls (via TanStack Query) to learn who is signed
 * in. Returns `null` when there is no valid session. Keeps `db` + session
 * verification server-side; the client only ever sees the narrowed shape.
 */
export const fetchCurrentUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionUser | null> => {
    const user = await getCurrentUser();
    if (!user) {
      return null;
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role: user.role,
    };
  }
);
