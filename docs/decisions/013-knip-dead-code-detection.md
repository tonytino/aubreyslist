# ADR-013: knip for dead-code detection

## Status

Accepted

## Context

Nothing in the pipeline analysed the codebase for dead code — unused exports,
unreachable modules, or unused dependencies. Agent-first development makes this
acute: superseded code lingers because each agent adds without a global view of
what is still wired (e.g. `TrustPlaceholder`, a scaffold component no longer
rendered on the listing-detail page but still shipping with a passing test).
knip was already present as a **dependency-only** guard (`knip --include
dependencies,unlisted`, see `docs/agents/dependencies.md`), so the question
(AUB-199) was whether to extend it to full dead-code detection or reach for a
different tool (`ts-prune`, Biome rules).

The "no new dependencies without justification" Hard Rule applies. knip is
already a devDependency, so **no new package is added** — this ADR records the
decision to broaden knip's existing role rather than add a second tool.

## Decision

We use **knip** as the single dead-code guard: unused files, unused
exports/types, and unused/unlisted dependencies, run via `pnpm deadcode`. It
already models this repo (Vite/TanStack Start plugins, per-file entry points,
JSDoc tags for dynamic seams), so a second tool (`ts-prune` covers only exports;
Biome has no cross-module reachability analysis) would add surface for no gain.

## Consequences

- Run `pnpm deadcode` before a cleanup PR or when something looks orphaned. It is
  **not** part of `pnpm preflight`; it runs as its own CI job (**Dead code**) that
  fails a PR on any new dead code.
- Config lives in **`knip.jsonc`** (JSONC so every entry/ignore carries an inline
  rationale comment). The old `knip.json` and the `knip` npm script are gone.
- Do **not** silence a false positive by deleting a symbol reached dynamically
  (routes, `*.fn.ts` server-fn seams, drift-guard types, test fixtures). Prefer an
  entry glob or a `@knippublic` tag **with a rationale** — see
  `docs/agents/tooling.md → Dead-code check` for the decision procedure.
- Do not add a second dead-code/unused-export tool (`ts-prune`, ESLint plugins).
  If knip cannot model a case, configure it; don't layer tools.
