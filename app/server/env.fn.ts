import { createServerFn } from "@tanstack/react-start";
import { isProductionEnvironment } from "~/env";

/**
 * Server function the client calls (via TanStack Query) to learn whether this
 * deployment is real Production, per `VERCEL_ENV` (AUB-170). The root error
 * boundary uses this to decide whether to show the raw `error.message` (dev/
 * preview) or a sanitized generic message (production) — `import.meta.env.PROD`
 * cannot make that distinction because Vercel preview deployments are still
 * built in production mode. Exposing just this boolean keeps `getEnv()` /
 * `VERCEL_ENV` server-side, following the same `*.fn.ts` seam as
 * `fetchPreviewLoginEnabled` (`app/server/auth/preview-login.fn.ts`).
 */
export const fetchIsProductionEnvironment = createServerFn({ method: "GET" }).handler(
  async (): Promise<boolean> => isProductionEnvironment()
);
