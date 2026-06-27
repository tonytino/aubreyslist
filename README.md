# aubreyslist

A web app built from the construct template.

## Stack

- **TanStack Start** — full-stack React framework
- **TanStack Router** — type-safe file-based routing
- **TanStack Query** — server state management
- **Tailwind CSS v4** — utility-first styling
- **Biome** — linting + formatting
- **Vitest** — unit and component testing
- **Playwright** — end-to-end testing
- **Hono** — API layer with RPC
- **Drizzle + Neon** — type-safe Postgres

## Getting Started

```bash
pnpm install
cp .env.example .env   # then fill in DATABASE_URL — see docs/agents/environment.md
pnpm dev
```

Running E2E tests? Install browsers first with `pnpm test:e2e:install`.

## For Agents

Read [`AGENTS.md`](./AGENTS.md) before making any changes.
