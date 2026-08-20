# Observability (Sentry)

Error monitoring via [Sentry](https://sentry.io) and the
`@sentry/tanstackstart-react` SDK. Two capture surfaces — **client** (browser)
and **server** (SSR / API routes / server functions) — plus a Vite plugin that
owns source-map upload at build.

## Current Status (read this first)

- **Client capture is live.** The client SDK initializes before hydration.
- **Server capture is dormant.** The `Sentry.init(...)` call and
  request/middleware wiring exist, but nothing loads `instrument.server.mjs`
  before the server boots in production, and source-map upload is not enabled.
  Both are **deferred to AUB-106** — until it lands, server-side events are not
  reliably captured or symbolicated in production.
- **PII / data-collection posture is deferred to AUB-107.** Both `Sentry.init`
  calls intentionally use library defaults; the deliberate PII-scrubbing
  decision is tracked there.

## Source Layout Note

App code lives in `app/` (`vite.config.ts` sets
`tanstackStart({ srcDirectory: "app" })`), so the Sentry entry files
(`app/instrument.client.ts`, `app/server.ts`, `app/start.ts`) live under `app/`.
The server init module `instrument.server.mjs` sits at the **repo root** — it is
loaded via `--import` outside the app module graph.

## Client Capture

- **`app/instrument.client.ts`** calls `Sentry.init({ dsn })`. It is the very
  first import in `app/client.tsx`, so the SDK initializes before hydration.
- **`RootErrorBoundary`** in `app/routes/__root.tsx` calls
  `Sentry.captureException(error)` in a `useEffect` — errors handled by a
  TanStack Router `errorComponent` are not auto-reported, so the boundary
  forwards them explicitly.

## Server Capture (dormant until AUB-106)

- **`instrument.server.mjs`** (repo root) calls `Sentry.init({ dsn })`. It must
  be evaluated **before any other server code** so auto-instrumentation can
  patch Node internals early; the production `--import` wiring that guarantees
  that ordering is AUB-106.
- **`app/server.ts`** wraps the framework's default `handler` with
  `wrapFetchWithSentry` (tracing/error capture around every server-side fetch),
  registered via `createServerEntry`.
- **`app/start.ts`** installs `sentryGlobalRequestMiddleware` and
  `sentryGlobalFunctionMiddleware` as the **first** entries in the request and
  server-function middleware chains. Keep the Sentry entries first if other
  global middleware is added.

## Vite Plugin

`sentryTanstackStart` (from `@sentry/tanstackstart-react/vite`) is registered in
`vite.config.ts` after the framework plugins and before the Nitro build target,
per Sentry's documented ordering. It uploads source maps and auto-instruments
the global middleware from `app/start.ts`. Config: `org: "brbcoding"`,
`project: "aubreyslist"`, `authToken: process.env.SENTRY_AUTH_TOKEN`. When the
token is absent (local dev), source-map upload is skipped and the plugin
no-ops.

## Secrets

- **DSN is public.** It only identifies the Sentry project; committing it is
  safe and expected.
- **`SENTRY_AUTH_TOKEN` is a build-time-only secret** — provided only in
  **Vercel** and **GitHub Actions**, never locally. Read in `vite.config.ts`
  under the sanctioned build-tooling exception to the "no `process.env` outside
  `app/env.ts`" rule. See `docs/agents/environment.md`.

## Validating Capture Locally

- **Client:** run `pnpm dev`, trigger a browser error, confirm the event in the
  Sentry issues feed for `aubreyslist`.
- **Server:** the production `--import` is not wired yet (AUB-106), so load the
  init module yourself:

  ```bash
  NODE_OPTIONS='--import ./instrument.server.mjs' pnpm dev
  ```

  Then trigger a server-side error and check the Sentry issues feed.

## Supporting Config

- **License review:** `@sentry/cli` and its native binaries are
  `FSL-1.1-MIT`-licensed build-time-only deps, recorded in
  `REVIEWED_EXCEPTIONS` in `.github/scripts/check-licenses.mjs` (build tool;
  never shipped in a bundle).
- **Coverage:** `app/instrument.client.ts`, `app/server.ts`, and `app/start.ts`
  are excluded from coverage in `vitest.config.ts` — thin init/wiring modules
  with no branching logic.

## Post-Deploy Smoke Check (AUB-157)

`.github/workflows/post-deploy-smoke.yml` curls the **live** production
deployment's `/api/health` and `/about` right after a deploy (successful
production `deployment_status` event), plus a 6-hourly `schedule` backstop and
`workflow_dispatch`. Distinct from `ci.yml`'s "Production build smoke" job,
which only tests a locally-built instance on `localhost:3000` — that cannot
catch a deploy that builds but fails to serve traffic.

**Production URL source:** the workflow reads the `PRODUCTION_URL` **repo
variable** (a Variable, not a Secret — public URL), falls back to the
triggering deployment's own `target_url`, and fails loudly otherwise. It
deliberately does **not** default to `SITE_URL` (`app/lib/seo.ts`) — decoupling
the smoke-check target from the SEO constant means a domain migration can't
silently point the check at a host not serving the app. The custom domain is
the hyphenated `www.aubreys-list.com` (the unhyphenated `aubreyslist.com` is
not ours); `PRODUCTION_URL` should be set to it. Full precedence rule: the
workflow file's header comment.

**Relationship to AUB-155 (uptime monitoring):** AUB-155 tracks a third-party
always-on monitor polling `/api/health` with alerting — the steady-state safety
net. This workflow is a narrower, deploy-triggered gate, not a replacement.
Once AUB-155's monitor exists, note its service + alert destination in this
section.

## See Also

- `docs/decisions/009-vercel-hosting-v1.md` (ADR-009) — hosting and Nitro
  presets; source-map upload runs in the Vercel/CI build.
- `docs/agents/environment.md` — env-var rules and the build-tooling secret
  exception.
- `.github/workflows/post-deploy-smoke.yml` — the post-deploy smoke check.
