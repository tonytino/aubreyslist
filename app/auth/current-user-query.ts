import { queryOptions } from "@tanstack/react-query";
import { fetchCurrentUser } from "~/server/auth/current-user.fn";

// Re-exported so consumers get the user type from the same module as the query.
export type { SessionUser } from "~/server/auth/current-user.fn";

/**
 * Shared `queryOptions` for the signed-in user. Lives in its own module so the
 * root loader and the header both import it without a cycle through
 * `__root.tsx`.
 */
export const currentUserQuery = queryOptions({
  queryKey: ["current-user"],
  queryFn: () => fetchCurrentUser(),
});
