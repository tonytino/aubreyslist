import { queryOptions } from "@tanstack/react-query";
import { fetchPreviewLoginEnabled } from "~/server/auth/preview-login.fn";

/**
 * Shared `queryOptions` for "is the preview dev-login active here". The root
 * loader prefetches it (`ensureQueryData`) and the header reads it
 * (`useSuspenseQuery`) so the preview-only "Dev sign-in" link renders correctly
 * on first paint. Its own module (like `current-user-query`) so both sides
 * import it without a cycle through `__root.tsx`.
 *
 * The value is derived from deploy-time env and never changes within a running
 * deployment, so it is effectively immutable — `staleTime: Infinity` avoids any
 * refetch.
 */
export const previewLoginEnabledQuery = queryOptions({
  queryKey: ["preview-login-enabled"],
  queryFn: () => fetchPreviewLoginEnabled(),
  staleTime: Number.POSITIVE_INFINITY,
});
