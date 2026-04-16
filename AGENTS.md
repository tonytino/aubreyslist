# AGENTS.md

Source of truth for all agents in this repo. Read this file fully before making any changes.

---

## Before You Start Any Task

1. Read this file fully.
2. **If `TEMPLATE.md` exists in this repo**, read it before doing anything else — it means you are modifying the construct template itself, not a project built from it. The design principles there govern every decision.
3. Check `docs/agents/` for a sub-doc relevant to your task and read it fully before proceeding.
4. If no relevant sub-doc exists yet, follow the **Documentation Philosophy** below before creating one.

### Sub-Doc Index

| Task involves...                           | Read this first                  |
| ------------------------------------------ | -------------------------------- |
| Finding and claiming work                  | `docs/agents/tasks.md`           |
| Routes, pages, navigation                  | `docs/agents/routing.md`         |
| API endpoints, server logic                | `docs/agents/api.md`             |
| Database, schema, migrations               | `docs/agents/database.md`        |
| Tests (unit, component, E2E)               | `docs/agents/testing.md`         |
| Styling, Tailwind, CSS                     | `docs/agents/styling.md`         |
| Environment variables                      | `docs/agents/environment.md`     |
| Propagating construct updates to instances | `docs/agents/propagation.md`     |
| Dependencies, versioning, overrides        | `docs/agents/dependencies.md`    |

---

## Documentation Philosophy

This repo uses **progressive documentation** — `AGENTS.md` stays lean and links out to focused sub-docs. Follow these rules when creating or updating documentation:

- **`AGENTS.md` contains only:** critical non-negotiables, the sub-doc index, and the stack overview. Do not add task-specific detail here.
- **`docs/agents/` contains:** focused sub-docs, one per concern. Each sub-doc covers one area in enough depth for an agent to complete a task without guessing.
- **When to create a new sub-doc:** when a task area isn't covered and the detail needed would bloat `AGENTS.md`.
- **When to update an existing sub-doc:** when you change behavior, add patterns, or discover an undocumented convention. Leave the repo better than you found it.
- **Sub-doc naming:** lowercase, hyphenated, descriptive. e.g. `auth.md`, `error-handling.md`, `payments.md`.
- **Keep sub-docs task-oriented:** write for an agent about to do something, not as reference material. Lead with the decision rule or the most common action.

---

## Stack

| Concern              | Tool                          | Notes                                      |
| -------------------- | ----------------------------- | ------------------------------------------ |
| Framework            | TanStack Start v1             | Built on Vinxi                             |
| Routing              | TanStack Router (file-based)  | Type-safe, auto-generates route tree       |
| Server State         | TanStack Query v5             | For all async/server data                  |
| API Layer            | Hono v4 + server functions    | Dual-layer: server fns for route data, Hono for portable endpoints. See `docs/agents/api.md` |
| Database             | Neon (serverless Postgres)    | Drizzle ORM, schema in `db/schema.ts`      |
| Styling              | Tailwind CSS v4               | Oxide engine, CSS-first config             |
| Linting + Formatting | Biome                         | Replaces ESLint + Prettier                 |
| Unit/Component Tests | Vitest + Testing Library      | Co-located with source                     |
| E2E Tests            | Playwright                    | Lives in `tests/e2e/`                      |
| Validation           | Zod                           | Runtime validation + type inference        |
| Language             | TypeScript (strict)           | No `any`, no `@ts-ignore`                  |
| Package Manager      | pnpm                          | Do not use npm or yarn                     |

---

## Hard Rules

These apply everywhere, always, with no exceptions.

- **No `process.env` access outside `app/env.ts`.** All env vars go through the Zod-validated `env` export.
- **No `any`.** Use `unknown` and narrow it, or fix the type properly.
- **No `@ts-ignore` or `@ts-expect-error`** without a comment explaining why.
- **No `useEffect` + `useState` for data fetching.** Use TanStack Query.
- **No `db` imports in client-side code.** Database access is server-only.
- **No raw `fetch` against Hono routes from the frontend.** Use the RPC client.
- **No manual edits to `app/routeTree.gen.ts` or `db/migrations/`.** Both are auto-generated.
- **No new dependencies** without checking if the existing stack already covers the need.
- **No skipping tests** for code you add.
- **pnpm only.** Never use npm or yarn.
- **Run `pnpm preflight` before declaring work complete.** This single command runs lint, typecheck, and tests.
- **Run `pnpm check` before every commit.**

---

## Finding Work

Tasks are tracked as GitHub Issues. The full workflow is in `docs/agents/tasks.md`.

Quick reference:

```bash
# Discover claimable tasks
gh issue list --label "status:ready,safe:agent" --assignee "" --state open

# Claim a task (replace <NUMBER>)
gh issue edit <NUMBER> --add-assignee "@me"
gh issue edit <NUMBER> --remove-label "status:ready" --add-label "status:in-progress"
```

Branch naming: `issue-<NUMBER>-<short-slug>`

After work is done, open a PR with `Closes #<NUMBER>` and relabel to `status:needs-review`.

---

## Template Version Tracking

Projects scaffolded from construct contain a `.construct` JSON file at the repo root. Its `constructVersion` field records which version of the template was used. Agents working in a scaffolded project should check this file to understand what template features are available. See `docs/agents/propagation.md` for the full propagation workflow.

---

## Commands

```bash
pnpm dev              # Start dev server
pnpm build            # Production build
pnpm start            # Start production server
pnpm check            # Biome lint + format (auto-fix) — run before committing
pnpm typecheck        # TypeScript check
pnpm test             # Vitest watch mode
pnpm test:e2e         # Playwright E2E (headless)
pnpm test:e2e:ui      # Playwright interactive UI
pnpm db:generate      # Generate migrations after schema changes
pnpm db:migrate       # Apply pending migrations
pnpm preflight        # Single-command validation: lint + typecheck + tests
pnpm db:studio        # Open Drizzle Studio
```
