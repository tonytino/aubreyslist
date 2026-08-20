import { queryOptions } from "@tanstack/react-query";
import { fetchIsProductionEnvironment } from "~/server/env.fn";

/**
 * Shared `queryOptions` for whether this deployment is real production. The
 * truth is the server's `VERCEL_ENV` — never `import.meta.env.PROD`, which is
 * also true on Vercel preview deployments (they build in production mode).
 * Lives in its own module so the root loader and the error boundary import it
 * without a cycle through `__root.tsx`.
 *
 * Derived from deploy-time env and immutable within a deployment, so
 * `staleTime: Infinity` avoids refetches.
 */
export const isProductionEnvironmentQuery = queryOptions({
  queryKey: ["is-production-environment"],
  queryFn: () => fetchIsProductionEnvironment(),
  staleTime: Number.POSITIVE_INFINITY,
});
