/// <reference types="vite/client" />

// Ambient types for Vite asset imports. `vite/client` provides these when it
// resolves, but vite is a transitive (non-hoisted) dependency here, so we
// declare the ones we use explicitly. Wildcard module declarations only match
// non-relative specifiers, so import these via the `~/` alias (see
// app/routes/__root.tsx) rather than a relative path.

declare module "*?url" {
  const src: string;
  export default src;
}

declare module "*?raw" {
  const src: string;
  export default src;
}
