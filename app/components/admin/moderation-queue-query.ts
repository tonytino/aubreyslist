import { queryOptions } from "@tanstack/react-query";
import { fetchModerationQueue } from "~/server/moderation/queue.fn";

/**
 * Shared TanStack Query options for the moderation queue.
 *
 * Kept in its own (client-safe) module so the admin route loader can prefetch
 * the queue into the dehydrated cache and the {@link ModerationQueue} component
 * can read it back from the same key with `useSuspenseQuery` — no loading
 * flash, one source of the key. Importing only the `*.fn` server function
 * keeps `db` out of the client bundle.
 */

/** Query key for the moderation queue — stable so actions can invalidate it. */
export const moderationQueueQueryKey = ["moderation-queue"] as const;

export function moderationQueueQueryOptions() {
  return queryOptions({
    queryKey: moderationQueueQueryKey,
    queryFn: () => fetchModerationQueue(),
  });
}
