# Construct Changelog

All notable changes to the construct template will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## Propagation Tags

Each entry is tagged to guide agents propagating changes to construct instances:

- `[propagate]` — should be applied to all existing instances where possible
- `[template-only]` — affects the template or scaffold process only, not instances
- `[manual]` — requires human judgment before applying to instances

---

## [Unreleased]

### Added

- `[propagate]` Pinned the Node version: `engines.node` (`>=22`) in `package.json` and a root `.nvmrc`. CI now reads the pin via `actions/setup-node` `node-version-file` (in `ci.yml` and `validate-template.yml`) so the declared version and CI can't drift.

### Changed

- `[propagate]` Completed the `pnpm.overrides` set and switched it to exact pins: all **25** `@tanstack/*` router/start internal packages are now pinned to their exact resolved versions (`1.114.29`–`1.114.35`) instead of the original `~1.114.3` range, matching the policy in `docs/agents/dependencies.md`. (The `[0.2.0]` entry's "17 packages / `~1.114.3`" records what that release shipped; this entry records the later completion so the CHANGELOG no longer contradicts `package.json`.)

---

## [0.2.0] - 2026-04-21

### Added

- `[propagate]` GitHub Issues-based agentic task management system with label taxonomy (`status:`, `type:`, `size:`, `safe:` groups)
- `[propagate]` `docs/agents/tasks.md` — agent workflow guide for discovering, claiming, and handing off work
- `[template-only]` `.github/ISSUE_TEMPLATE/agent-task.yml` and `bug-report.yml` for structured issue creation
- `[template-only]` `.github/workflows/ci.yml` — CI pipeline (lint, typecheck, unit tests, E2E) on push and PR
- `[template-only]` `.github/workflows/validate-template.yml` — scaffold-and-verify pipeline for every PR
- `[template-only]` `.github/workflows/release-check.yml` — enforces CHANGELOG entry and migration guide on version bumps
- `[template-only]` `scripts/labels.mjs` — exportable label definitions; scaffold creates them in GitHub automatically
- `[propagate]` `.env.example` with `DATABASE_URL` and Neon provisioning guide in `docs/agents/environment.md`
- `[template-only]` Unit tests for label definitions, issue templates, and CI workflow structure
- `[propagate]` Error boundary + 404 page in `app/routes/__root.tsx` via `notFoundComponent` and `errorComponent`
- `[propagate]` Example server function in `app/routes/index.tsx` demonstrating `createServerFn`
- `[propagate]` Example unit test (`app/utils/format.ts` + test) and component test (`app/components/Greeting.tsx` + test)
- `[propagate]` `postinstall: "tsr generate"` in `package.json` and `@tanstack/router-cli` dev dependency
- `[propagate]` `tsr.config.json` pointing route generator at `app/routes/` and `app/routeTree.gen.ts`
- `[propagate]` `pnpm.overrides` block pinning 17 `@tanstack/*` packages to `~1.114.3` to prevent v1.167 drift
- `[propagate]` `.gitignore` with `node_modules`, build outputs, env files, `routeTree.gen.ts`, `app.config.timestamp_*`, `.claude/`
- `[propagate]` `"preflight"` script — single-command validation (lint + typecheck + tests)
- `[propagate]` `"prepare": "lefthook install"` and `lefthook` dev dependency for pre-commit hooks
- `[propagate]` `lefthook.yml` with pre-commit hook running `biome check --staged` on staged files
- `[propagate]` `"packageManager": "pnpm@9.15.0"` for deterministic pnpm version across machines and CI
- `[propagate]` `.github/pull_request_template.md` with Summary / Issues / Test plan / Propagation checklist
- `[propagate]` `docs/agents/dependencies.md` — dependency governance policy (range strategy, override pattern, adding new packages)
- `[propagate]` `docs/agents/releases.md` — release convention for version bumps (CHANGELOG + migration guide + propagation)
- `[propagate]` `docs/agents/tooling.md` — when to use `pnpm check` vs `pnpm preflight` vs Lefthook
- `[template-only]` `docs/decisions/` — Architecture Decision Records framework with 5 initial ADRs (TanStack Start, dual-layer API, Neon, Biome, file-based routing)
- `[template-only]` `docs/migrations/` — versioned migration guide framework with `template.md` and `v0.2.md`

### Changed

- `[propagate]` Template version bumped to `0.2.0`; `.construct` records this on scaffold and propagation
- `[propagate]` `AGENTS.md` — "Before You Start" now references `TEMPLATE.md` when present; added "Finding Work", "Template Version Tracking" sections; Sub-Doc Index now points to `docs/decisions/`, `docs/migrations/`, `docs/agents/dependencies.md`, `docs/agents/releases.md`, `docs/agents/tooling.md`; `pnpm preflight` promoted to hard rule
- `[propagate]` `docs/agents/api.md` — expanded with decision table and server function examples
- `[propagate]` `docs/agents/propagation.md` — documents `.construct` version tracking, migration guide precedence, what propagates vs what stays template-only
- `[propagate]` `docs/agents/tasks.md` — adds `pnpm preflight` step and pre-commit hook section
- `[propagate]` `biome.json` — `files.ignore` now includes `app.config.timestamp_*` and `.claude/`
- `[propagate]` `.github/workflows/ci.yml` — `pnpm install --frozen-lockfile`, pnpm cache via `setup-node`, E2E gated on `CI_E2E_DATABASE_URL` secret
- `[template-only]` `TEMPLATE.md` — added maintainer callout for keeping `labels.mjs` and `tasks.md` in sync
- `[template-only]` `scripts/scaffold.mjs` — label setup step with human confirmation prompt added; substitutes project name into `AGENTS.md`

### Fixed

- `[template-only]` `drizzle.config.ts` — removed non-null assertion on `DATABASE_URL`; now throws a clear error if unset
- `[propagate]` TanStack v1.167 incompatibility (dropped vinxi support) — pinned to `~1.114.3` via `pnpm.overrides`

---

## [0.1.0] - 2026-04-13

### Added

- `[template-only]` Initial construct template release
- `[template-only]` TanStack Start v1 + TanStack Router + TanStack Query
- `[template-only]` Hono v4 API layer with RPC, mounted at `/api/*`
- `[template-only]` Drizzle ORM + Neon serverless Postgres
- `[template-only]` Tailwind CSS v4 with Oxide engine
- `[template-only]` Biome for linting and formatting
- `[template-only]` Vitest + Testing Library for unit/component tests
- `[template-only]` Playwright for E2E tests
- `[template-only]` Zod-based environment variable validation via `app/env.ts`
- `[template-only]` GitHub Actions CI workflow
- `[template-only]` Progressive agent documentation (`AGENTS.md` + `docs/agents/`)
- `[template-only]` Interactive scaffold script (`pnpm scaffold`)
- `[template-only]` `.construct` metadata written at scaffold time for version tracking
