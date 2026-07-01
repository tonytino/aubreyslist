# ADR-012: TanStack Start vinxi→Vite-plugin migration and @tanstack de-pin

## Status

Accepted

## Context

The project was pinned to TanStack Start `~1.114.3` running on **vinxi 0.5**, held
together by a ~25-entry `pnpm.overrides` block that froze every `@tanstack/*`
internal package to an exact `1.114.x` patch (see the old "TanStack Override
Pattern" in `docs/agents/dependencies.md`). That pin was load-bearing: newer
`@tanstack/*` minors had already broken `vinxi build` against the `1.114` core.

The `Dependency vulns (osv-scanner)` CI gate flagged a `vite`/`esbuild`/
`@tanstack/start-server-core` advisory cluster that **only clears in vite 6+ and
TanStack Start ≥ 1.167**. Phase 1 (PR #197) cleared ~35 of 57 advisories but
deliberately left this cluster, because vite could not be bumped under vinxi.
TanStack Start **dropped vinxi in v1.120** and became a **Vite plugin**; the
published `1.167+` line is a post-Nitro-bundling, Vite-environments architecture
that peers on **vite ≥ 7** (which supersedes the osv-fixed vite 6.x floor). The
maintainer also decided to **de-pin** the `@tanstack/*` overrides — the plugin now
manages its own coordinated internal versions, so the exact-pin block is obsolete.

## Decision

Upgrade to TanStack Start `^1.167` (resolves `react-start@1.168.x`,
`react-router@1.170.x`, vite 7), delete the entire `@tanstack/*` `pnpm.overrides`
block and move the top-level `@tanstack/*` deps to `^` ranges, and replace vinxi
with the Vite plugin (`tanstackStart()` from `@tanstack/react-start/plugin/vite`)
plus `@tanstack/nitro-v2-vite-plugin` for the Node/Vercel build target — keeping
the `.output/server/index.mjs` layout and the VERCEL preset conditional (ADR-009).

## Consequences

- **Config**: `app.config.ts` is replaced by `vite.config.ts`. The framework is
  registered as `tanstackStart({ srcDirectory: "app" })` alongside `viteReact()`,
  `tailwindcss()`, `tsconfigPaths()`, and `nitroV2Plugin(...)`. Scripts are plain
  vite: `dev: vite dev`, `build: vite build`, `start: node .output/server/index.mjs`.
- **Entries**: `app/router.tsx` must export **`getRouter`** (the plugin auto-imports
  it via the `#tanstack-router-entry` virtual module) — not `createRouter`.
  `app/client.tsx` renders `<StartClient />` with no props. `app/ssr.tsx` and
  `app/api.ts` are **deleted**: the plugin provides the default server entry
  (`createStartHandler(defaultStreamHandler)`) and there is no separate API router.
- **API / Hono handoff**: the `/api/*` catch-all in `app/routes/api.$.ts` is now a
  **Server Route** — `createFileRoute("/api/$")({ server: { handlers: { GET, POST,
  … } } })`, each handler delegating to `app.fetch(request)`. The Hono app
  (`app/server/index.ts`) is unchanged; behaviour is identical.
- **Client asset layout changed**: browser bundles now land at
  `.output/public/assets/` (was `.output/public/_build/assets/`) and the client
  entry is `assets/index-*.js` (was `_build/assets/client-*.js`). The CI
  `build-smoke` guard and the E2E hydration spec were updated to the new paths.
- **Dev server port**: Vite defaults to `:5173`; pinned back to `:3000` in
  `vite.config.ts` so Playwright and `pnpm start` stay on one port.
- **Server-fn unit tests**: calling a `createServerFn` value now runs the
  framework middleware pipeline, which reads a per-request Start context from
  `AsyncLocalStorage`. Tests wrap calls in `callServerFn()`
  (`tests/server-fn.ts`, backed by `runWithStartContext` from
  `@tanstack/start-storage-context`) — this supplies the ambient context without
  stubbing any of the function's real behaviour.
- **De-pin**: the `@tanstack/*` overrides block is gone. The Phase-1 leaf
  overrides (`shell-quote`, `h3`, `nitropack`, `tar`, `ws`, `brace-expansion@5`,
  `@babel/core`, `qs`, `diff`) and `engines.node` / `packageManager` stay. If a
  future `@tanstack/*` minor breaks the build, prefer a version bump over
  reintroducing the exact-pin block.
