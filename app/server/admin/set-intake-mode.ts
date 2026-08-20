import { z } from "zod";
import { requireCurrentRole } from "~/server/auth/guards";
import { INTAKE_MODES, type IntakeMode, setSetting } from "~/server/settings";

/**
 * Server-only logic behind the `setIntakeMode` server fn (ADR-008).
 *
 * Flipping the intake mode (`places` <-> `manual`) is admin-only: ADR-010
 * requires the gate enforced server-side off the authoritative `users` row,
 * never trusted to the UI.
 *
 * 1. {@link requireCurrentRole}`("admin")` — `401` anonymous, `403` any
 *    signed-in non-admin (moderators get the flag queue, not settings).
 * 2. Zod-validate the input. Allowed `mode` values derive from the settings
 *    registry's {@link INTAKE_MODES}, so the boundary cannot drift from the
 *    codec.
 * 3. `setSetting("intake_mode", mode)` — upserts the canonical text value.
 *
 * The auth gate lives on this {@link setIntakeMode} entry point, not inside
 * the un-guarded `setSetting` seam — see the admin-guard seam note on
 * `app/server/settings/index.ts`.
 *
 * Lives in its own module (not the route-imported `set-intake-mode.fn.ts`) so
 * its `db`-bound imports never leak into the client bundle.
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
