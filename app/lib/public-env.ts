/**
 * Typed accessors for public, compile-time environment variables.
 *
 * `VITE_`-prefixed vars are statically inlined into the client bundle, so they
 * are public by definition and must never hold a secret. They live outside
 * `app/env.ts` deliberately: the server-env Hard Rule guards runtime
 * server-side secrets behind the server-only `getEnv()`, and a `VITE_` var is
 * neither runtime nor secret. This module is the single sanctioned home for
 * `import.meta.env.VITE_*` reads. See `docs/agents/environment.md` →
 * "Public client-side variables".
 */

/**
 * The Google Maps browser key for the directory map. A public key, restricted
 * by HTTP referrer — safe to expose in the client bundle. Distinct from the
 * server-side `GOOGLE_PLACES_API_KEY`, which stays secret in `app/env.ts`
 * (ADR-008).
 *
 * Returns `null` when the key is unset/blank. Callers must degrade gracefully
 * (the map falls back to the CSS placeholder) so dev, CI, and E2E work
 * without a key.
 */
export function googleMapsBrowserKey(): string | null {
  const key = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY;
  if (typeof key !== "string") return null;
  const trimmed = key.trim();
  return trimmed === "" ? null : trimmed;
}
