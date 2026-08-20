import { queryOptions } from "@tanstack/react-query";
import { fetchPreviewLoginEnabled } from "~/server/auth/preview-login.fn";

/**
 * Shared `queryOptions` for whether the preview dev-login is active. Lives in
 * its own module so the root loader and the header import it without a cycle
 * through `__root.tsx`.
 *
 * Derived from deploy-time env and immutable within a deployment, so
 * `staleTime: Infinity` avoids refetches.
 */
export const previewLoginEnabledQuery = queryOptions({
  queryKey: ["preview-login-enabled"],
  queryFn: () => fetchPreviewLoginEnabled(),
  staleTime: Number.POSITIVE_INFINITY,
});
