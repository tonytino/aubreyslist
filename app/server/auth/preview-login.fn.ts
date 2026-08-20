import { createServerFn } from "@tanstack/react-start";
import { isPreviewLoginEnabled } from "./preview-login";

/**
 * Server function telling the client whether the preview-only dev-login is
 * active on this deployment, so the header shows a "Dev sign-in" affordance
 * only where it works.
 *
 * Mirrors the endpoint's own gate ({@link isPreviewLoginEnabled}): `true` only
 * on a preview/development deployment with `PREVIEW_LOGIN_SECRET` set, `false`
 * in production. Exposing just this boolean keeps the secret server-side.
 */
export const fetchPreviewLoginEnabled = createServerFn({ method: "GET" }).handler(
  async (): Promise<boolean> => isPreviewLoginEnabled()
);
