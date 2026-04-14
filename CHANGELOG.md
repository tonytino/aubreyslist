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
