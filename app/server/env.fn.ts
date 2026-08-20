import { createServerFn } from "@tanstack/react-start";
import { isProductionEnvironment } from "~/env";

/**
 * Server function the client calls (via TanStack Query) to learn whether this
 * deployment is real production, per `VERCEL_ENV`. The root error boundary
 * uses this to decide between the raw `error.message` (dev/preview) and a
 * sanitized generic message (production) — `import.meta.env.PROD` cannot make
 * that distinction because Vercel preview deployments are still built in
 * production mode. Exposing just this boolean keeps `getEnv()` / `VERCEL_ENV`
 * server-side, per the `*.fn.ts` seam.
 */
export const fetchIsProductionEnvironment = createServerFn({ method: "GET" }).handler(
  async (): Promise<boolean> => isProductionEnvironment()
);
