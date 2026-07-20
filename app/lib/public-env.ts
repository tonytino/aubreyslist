/**
 * Typed accessors for PUBLIC, compile-time environment variables (AUB-111).
 *
 * These are `VITE_`-prefixed vars that Vite statically inlines into the client
 * bundle at build time via `import.meta.env` — by definition they are PUBLIC
 * and must never hold a secret. They are deliberately OUTSIDE `app/env.ts`:
 * the server-env Hard Rule (see AGENTS.md; enforced by check-hard-rules.mjs,
 * which is why this comment names it indirectly) exists to keep
 * RUNTIME, SERVER-SIDE secrets behind the Zod-validated `getEnv()`; a `VITE_`
 * var is neither runtime nor secret (it is baked into the shipped JS), and
 * `getEnv()` is server-only, so client code cannot reach it. This module is
 * the single sanctioned home for `import.meta.env.VITE_*` reads so raw
 * `import.meta.env` never scatters across components. See
 * `docs/agents/environment.md` → "Public client-side variables".
 */

/**
 * The Google Maps *browser* key for the directory map (AUB-111, provisioned by
 * AUB-217). This is a PUBLIC key, restricted by HTTP referrer in the Google
 * Cloud console — safe to expose in the client bundle by design (that is how
 * the Maps JavaScript API works). It is a different key from the server-side
 * `GOOGLE_PLACES_API_KEY`, which stays secret in `app/env.ts` (ADR-008).
 *
 * Returns `null` when the key is unset/blank — callers MUST degrade gracefully
 * (the directory map falls back to the stylized CSS placeholder), so local
 * dev, CI, and E2E all work deterministically without a key.
 */
export function googleMapsBrowserKey(): string | null {
  const key = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY;
  if (typeof key !== "string") return null;
  const trimmed = key.trim();
  return trimmed === "" ? null : trimmed;
}
