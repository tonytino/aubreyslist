# Aubrey's List

A community-driven directory of how safe restaurants are for people with a
gluten-free / celiac need, piloting in Denver, CO. Built from the construct
template, agent-first. See [`docs/product/overview.md`](./docs/product/overview.md)
for the product vision and v1 decision record.

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
