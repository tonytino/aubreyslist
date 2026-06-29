import { z } from "zod";
import { requireCurrentRole } from "~/server/auth/guards";
import { INTAKE_MODES, type IntakeMode, setSetting } from "~/server/settings";

/**
 * Server-only logic behind the `setIntakeMode` server fn (#24, ADR-008).
 *
 * Flipping the active listing-intake mode (`places` <-> `manual`) is an
 * admin-only operation: per `domain.md` Roles, managing app settings is an
 * admin power, and ADR-010 requires the gate to be enforced SERVER-SIDE off the
 * authoritative `users` row, never trusted to the UI. This mirrors `setRole`
 * exactly:
 *
 * 1. {@link requireCurrentRole}`("admin")` — throws `401` for an anonymous
 *    caller and `403` for any signed-in non-admin (a plain `user` OR a
 *    `moderator` — moderators get the flag queue, NOT settings). Only admins
 *    proceed.
 * 2. Zod-validate the input. The allowed `mode` values are derived from the
 *    settings registry's {@link INTAKE_MODES} (the same source the
 *    `intake_mode` codec uses), so the boundary can never drift from the codec.
 * 3. `setSetting("intake_mode", mode)` — upserts the canonical TEXT value.
 *
 * The auth gate lives on this {@link setIntakeMode} entry point (the boundary
 * under test) rather than inside the un-guarded `setSetting` seam — see the
 * admin-guard seam note on `app/server/settings/index.ts`.
 *
 * Lives in its own module (NOT the route-imported `set-intake-mode.fn.ts`) so
 * its `db`-bound imports (`setSetting`, `requireCurrentRole`) never leak into
 * the client bundle.
 */

/**
 * Validated input for {@link setIntakeMode}. `mode` is constrained to the
 * settings registry's `IntakeMode` union (`places | manual`), derived from
 * {@link INTAKE_MODES} so it cannot diverge from the codec's allowed values.
 */
export const setIntakeModeInputSchema = z.object({
  mode: z.enum(INTAKE_MODES),
});
export type SetIntakeModeInput = z.infer<typeof setIntakeModeInputSchema>;

/** What a successful toggle reports back: the now-active intake mode. */
export interface SetIntakeModeResult {
  intakeMode: IntakeMode;
}

/**
 * Set the active listing-intake mode (admin-only). Order of operations:
 * 1. {@link requireCurrentRole}`("admin")` — server-side gate (401 anon / 403 non-admin).
 * 2. Zod-validate the input (`mode` restricted to the registry's `IntakeMode`).
 * 3. `setSetting("intake_mode", mode)` — persists the value through its codec.
 */
export async function setIntakeMode(input: SetIntakeModeInput): Promise<SetIntakeModeResult> {
  await requireCurrentRole("admin");

  const { mode } = setIntakeModeInputSchema.parse(input);

  await setSetting("intake_mode", mode);

  return { intakeMode: mode };
}
