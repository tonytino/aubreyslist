# Observability (Sentry)

Error monitoring is provided by [Sentry](https://sentry.io) via the
`@sentry/tanstackstart-react` SDK. There are two capture surfaces — **client**
(browser) and **server** (SSR / API routes / server functions) — plus a Vite
plugin that owns source-map upload at build. This doc describes what is wired,
what is deliberately deferred, and how to validate capture locally.

## Current Status (read this first)

- **Client capture is live.** The client SDK initializes before hydration and
  reports browser errors today.
- **Server capture is currently dormant.** The `Sentry.init(...)` call and the
  request/middleware wiring exist, but nothing loads `instrument.server.mjs`
  before the server boots in production, and source-map upload is not enabled.
  Both the production `--import` of `instrument.server.mjs` **and** the
  source-map upload pipeline are **deferred to AUB-106**. Until AUB-106 lands,
  server-side events are not reliably captured or symbolicated in production.
- **PII / data-collection posture is deferred to AUB-107.** Both `Sentry.init`
  calls intentionally use library defaults (no `sendDefaultPii` /
  `dataCollection` tuning). A deliberate PII-scrubbing decision is tracked
  there.

## Source Layout Note

App code lives in `app/`, not the framework-default `src/`. `vite.config.ts`
sets `tanstackStart({ srcDirectory: "app" })`, so the Sentry entry files
(`app/instrument.client.ts`, `app/server.ts`, `app/start.ts`) live under `app/`.
The server init module `instrument.server.mjs` sits at the **repo root** (it is
loaded via `--import` outside the app module graph, so it is not under `app/`).

## Client Capture

- **`app/instrument.client.ts`** calls `Sentry.init({ dsn })`. It is imported
  **first** in `app/client.tsx` (`import "./instrument.client";` is the very
  first line) so the SDK initializes before hydration and can capture browser
  errors from the start.
- **`RootErrorBoundary`** in `app/routes/__root.tsx` calls
  `Sentry.captureException(error)` inside a `useEffect`. Errors handled by a
  TanStack Router `errorComponent` are not auto-reported, so the boundary
  forwards them to Sentry explicitly.

## Server Capture (dormant until AUB-106)

- **`instrument.server.mjs`** (repo root) calls `Sentry.init({ dsn })`. It must
  be evaluated **before any other server code** so auto-instrumentation can
  patch Node internals (http, fetch, etc.) early. The production `--import`
  wiring that guarantees that ordering is AUB-106; this file only owns the
  `Sentry.init(...)` call.
- **`app/server.ts`** is a custom SSR request-handler entry. It wraps the
  framework's default `handler` with `wrapFetchWithSentry`, adding
  tracing/error capture around every server-side fetch (SSR renders, API
  routes, server functions), then registers it via `createServerEntry`.
- **`app/start.ts`** uses `createStart` to install
  `sentryGlobalRequestMiddleware` and `sentryGlobalFunctionMiddleware` as the
  **first** entry in the request and server-function middleware chains, so
  Sentry attaches a trace/scope around the entire request before any of our own
  middleware runs. Keep the Sentry entries first if other global middleware is
  added later.

## Vite Plugin

`sentryTanstackStart` (from `@sentry/tanstackstart-react/vite`) is registered in
`vite.config.ts` after the framework plugins (`tanstackStart()`, `viteReact()`)
and before the Nitro build target, per Sentry's documented ordering. Its jobs
are uploading source maps for readable server stack traces and
auto-instrumenting the global middleware from `app/start.ts`. It is configured
with `org: "brbcoding"`, `project: "aubreyslist"`, and
`authToken: process.env.SENTRY_AUTH_TOKEN`. When the token is absent (local
dev), source-map upload is skipped and the plugin effectively no-ops.

## Secrets

- **DSN is public.** The DSN in both `Sentry.init` calls only identifies which
  Sentry project to send events to and carries no privileged access — committing
  it is safe and expected.
- **`SENTRY_AUTH_TOKEN` is a build-time-only secret.** It authorizes source-map
  upload and is provided only in **Vercel** and **GitHub Actions**, never
  locally. It is read in `vite.config.ts` (build tooling that never ships to the
  client) under the same sanctioned exception to the "no `process.env` outside
  `app/env.ts`" rule that covers the `VERCEL` flag and `drizzle.config.ts`. See
  `docs/agents/environment.md`.

## Validating Capture Locally

- **Client:** run `pnpm dev`, trigger a browser error (e.g. throw from a
  component or route loader), and confirm the event appears in the Sentry issues
  feed for the `aubreyslist` project.
- **Server:** the production `--import` is not wired yet (AUB-106), so to test
  server capture locally you must load the init module yourself:

  ```bash
  NODE_OPTIONS='--import ./instrument.server.mjs' pnpm dev
  ```

  Then trigger a server-side error (SSR render, API route, or server function)
  and check the Sentry issues feed.

## Supporting Config

- **License review:** `@sentry/cli` (and its platform-specific native binaries)
  are `FSL-1.1-MIT`-licensed build-time-only deps. They are recorded in
  `REVIEWED_EXCEPTIONS` in `.github/scripts/check-licenses.mjs` with the
  build-tool rationale (uploads source maps at build, never shipped in a
  bundle).
- **Coverage:** the entry files `app/instrument.client.ts`, `app/server.ts`, and
  `app/start.ts` are excluded from coverage in `vitest.config.ts` — they are
  thin init/wiring modules with no branching logic to test.

## Post-Deploy Smoke Check (AUB-157)

`.github/workflows/post-deploy-smoke.yml` curls the **live** production
deployment's `/api/health` and `/about` right after a deploy (on a successful
production `deployment_status` event), plus a sparse 6-hourly `schedule`
backstop and `workflow_dispatch` for manual runs. This is distinct from
`ci.yml`'s "Production build smoke" job, which only ever tests a
locally-built instance on `localhost:3000` in the CI runner — it cannot catch
a deploy that builds fine but fails to actually serve traffic (bad DNS, a
failed promotion, a runtime-only crash).

**Production URL source:** the workflow reads the `PRODUCTION_URL` **repo
variable** (Settings > Secrets and variables > Actions > Variables — a
Variable, not a Secret, since it's a public URL), falling back to the
triggering deployment's own `target_url` when the variable is unset, and
failing loudly otherwise. It deliberately does **not** default to
`SITE_URL` (`app/lib/seo.ts`, hardcoded to `https://www.aubreys-list.com`):
keeping the smoke-check target decoupled from the SEO constant means a future
domain migration can't silently point the check at a host that isn't serving
the app yet. The custom domain (hyphenated `www.aubreys-list.com` — the
unhyphenated `aubreyslist.com` is not ours) is now attached and indexed by
Google, so `PRODUCTION_URL` should be set to it. See the workflow file's
header comment for the full precedence rule.

**Relationship to AUB-155 (uptime monitoring):** AUB-155 tracks configuring a
third-party always-on monitor (e.g. UptimeRobot / Better Uptime) polling
`/api/health` continuously with alerting — the steady-state safety net. This
workflow is a narrower, deploy-triggered gate ("did *this* deploy come up
ok"), not a replacement for it. Once AUB-155's monitor is configured, note its
service + alert destination in this doc (this section is the intended home
for that).

## See Also

- `docs/decisions/009-vercel-hosting-v1.md` (ADR-009) — hosting and Nitro
  presets; Sentry source-map upload runs in the Vercel/CI build.
- `docs/agents/environment.md` — env-var rules and the build-tooling secret
  exception that `SENTRY_AUTH_TOKEN` relies on.
- `.github/workflows/post-deploy-smoke.yml` — the post-deploy smoke check
  (AUB-157) described above.
