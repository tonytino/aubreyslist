# construct

A single-app template optimized for agentic engineering. Clone it, scaffold it, build.

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

## Starting a New Project

Requires **Node >= 22** (see `.nvmrc`) and **pnpm** (pinned via `packageManager`).

```bash
git clone https://github.com/tonytino/construct my-project
cd my-project
pnpm install
pnpm scaffold
```

## For Agents

- Building a project from this template → read [`AGENTS.md`](./AGENTS.md)
- Modifying the template itself → read [`TEMPLATE.md`](./TEMPLATE.md)
- Propagating changes to instances → read [`docs/agents/propagation.md`](./docs/agents/propagation.md)
