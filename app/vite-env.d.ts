/// <reference types="vite/client" />

// Ambient types for Vite asset imports. `vite/client` provides these when it
// resolves, but vite is a transitive (non-hoisted) dependency here, so we
// declare the ones we use explicitly. Wildcard module declarations only match
// non-relative specifiers, so import these via the `~/` alias (see
// app/routes/__root.tsx) rather than a relative path.

// Typed surface for the app's PUBLIC `VITE_*` variables (statically inlined
// into the client bundle by Vite — never secrets). Merges into the
// `ImportMetaEnv` interface that `vite/client` declares. Read these ONLY via
// the typed accessors in `app/lib/public-env.ts`, never raw `import.meta.env`.
interface ImportMetaEnv {
  /**
   * Public, HTTP-referrer-restricted Google Maps browser key for the directory
   * map (AUB-111; provisioned by AUB-217). Optional — absent/blank means the
   * map view renders its CSS-placeholder fallback.
   */
  readonly VITE_GOOGLE_MAPS_BROWSER_KEY?: string;
}

declare module "*?url" {
  const src: string;
  export default src;
}

declare module "*?raw" {
  const src: string;
  export default src;
}
