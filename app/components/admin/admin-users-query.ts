import { queryOptions } from "@tanstack/react-query";
import { listUsers } from "~/server/admin/list-users.fn";

/**
 * Shared TanStack Query options for the admin user directory (issue #142).
 *
 * Kept in its own (client-safe) module so the role-management section can read
 * the directory with `useQuery` and a role mutation can invalidate it by the
 * same key after a successful change. Importing only the `*.fn` server function
 * keeps `db` out of the client bundle.
 *
 * This is admin-only data, but the SERVER FN re-runs `requireCurrentRole("admin")`
 * on every call — these query options are render-time convenience, never the
 * access control. Unlike the moderation queue, the directory is NOT prefetched
 * in the route loader: it is admin-only, lazily fetched only when the
 * role-management section mounts.
 */

/** Query key for the admin user directory — stable so a role change can invalidate it. */
export const adminUsersQueryKey = ["admin-users"] as const;

export function adminUsersQueryOptions() {
  return queryOptions({
    queryKey: adminUsersQueryKey,
    queryFn: () => listUsers(),
  });
}
