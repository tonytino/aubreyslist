import { createServerFn } from "@tanstack/react-start";
import { isPreviewLoginEnabled } from "./preview-login";

/**
 * Server function the client calls (via TanStack Query) to learn whether the
 * preview-only dev-login is active on this deployment — so the header can show a
 * discoverable "Dev sign-in" affordance ONLY where it works.
 *
 * It mirrors the endpoint's own gate ({@link isPreviewLoginEnabled}): `true`
 * only on a preview/development deployment WITH `PREVIEW_LOGIN_SECRET` set,
 * `false` (so the affordance is invisible) in production. The gate reads
 * server-only env via `getEnv()`; exposing just this boolean keeps the secret
 * itself server-side.
 */
export const fetchPreviewLoginEnabled = createServerFn({ method: "GET" }).handler(
  async (): Promise<boolean> => isPreviewLoginEnabled()
);
