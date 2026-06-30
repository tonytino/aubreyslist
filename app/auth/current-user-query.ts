import { queryOptions } from "@tanstack/react-query";
import { fetchCurrentUser } from "~/server/auth/current-user.fn";

// Re-export the narrowed user shape so consumers (header, user menu, tests) can
// import the type from the same module as the query.
export type { SessionUser } from "~/server/auth/current-user.fn";

/**
 * Shared `queryOptions` for "who is signed in". Lives in its own module so both
 * the root loader (which prefetches via `ensureQueryData`) and the header
 * component tree (`useSuspenseQuery`) can import it without a circular import
 * back through `__root.tsx`.
 */
export const currentUserQuery = queryOptions({
  queryKey: ["current-user"],
  queryFn: () => fetchCurrentUser(),
});
