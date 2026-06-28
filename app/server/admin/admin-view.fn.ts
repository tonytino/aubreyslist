import { createServerFn } from "@tanstack/react-start";
import type { Role } from "~/server/auth/guards";

/**
 * Server function backing the admin-panel shell (issue #38).
 *
 * This is the client-callable entry point the admin route loader uses; the
 * actual access-gate logic lives in the server-only `./admin-view` module and
 * is referenced only from inside the `createServerFn` handler below, so the
 * bundler strips it (and its `db`-bound imports) out of the client bundle.
 *
 * The exported `AdminView` / `AdminSettingsView` types are safe to import from
 * client code (type-only, erased at build time) and are consumed by the route
 * loader and the `AdminPanel` component.
 */

/** Read-only snapshot of the app settings shown in the (admin-only) settings section. */
export interface AdminSettingsView {
  /** Current listing-intake mode (ADR-008). */
  intakeMode: string;
  /** Current staleness window, in months (ADR-007). */
  stalenessMonths: number;
}

/**
 * What the admin route loader gets back. `access` discriminates the three UX
 * outcomes; `role` and `settings` are present only when access is granted.
 */
export type AdminView =
  | { access: "anonymous" }
  | { access: "forbidden" }
  | { access: "granted"; role: Exclude<Role, "user">; settings: AdminSettingsView | null };

export const fetchAdminView = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminView> => {
    // Imported lazily inside the handler so the server-only gate logic (and its
    // `db`-bound deps) stays out of the client bundle.
    const { resolveAdminView } = await import("./admin-view");
    return resolveAdminView();
  }
);
