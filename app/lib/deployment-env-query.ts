import { queryOptions } from "@tanstack/react-query";
import { fetchIsProductionEnvironment } from "~/server/env.fn";

/**
 * Shared `queryOptions` for "is this deployment real Production" (AUB-170).
 * The root loader prefetches it (`ensureQueryData`) and `RootErrorBoundary`
 * reads it so the sanitized-vs-raw error message decision uses the same
 * server-truth `VERCEL_ENV` signal as `isPreviewLoginEnabled` — never
 * `import.meta.env.PROD`, which can't tell a Vercel preview deployment (built
 * in production mode) apart from real production. Its own module (like
 * `previewLoginEnabledQuery`) so both the loader and the error boundary import
 * it without a cycle through `__root.tsx`.
 *
 * The value is derived from deploy-time env and never changes within a
 * running deployment, so it is effectively immutable — `staleTime: Infinity`
 * avoids any refetch.
 */
export const isProductionEnvironmentQuery = queryOptions({
  queryKey: ["is-production-environment"],
  queryFn: () => fetchIsProductionEnvironment(),
  staleTime: Number.POSITIVE_INFINITY,
});
