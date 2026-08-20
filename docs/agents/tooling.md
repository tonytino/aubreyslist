# Tooling

Code quality runs on Biome, Lefthook, and the `preflight` script.

## Decision Rule

| Situation | Command | What it does |
| --------- | ------- | ------------ |
| Writing code, iterating | `pnpm check` | Runs `biome check --write .` — **mutates files** to auto-fix lint and format issues across the whole repo |
| About to commit | *Nothing — Lefthook runs automatically* | Runs `biome check --staged` on staged files only — **read-only**. Blocks the commit if issues remain |
| "Is my change ready to ship?" | `pnpm preflight` | Runs `biome check .` + `tsc --noEmit` + `vitest run` — **read-only**, whole repo, all validators. Required before declaring work complete |
| Validating a dependency bump | `pnpm preflight && pnpm build` | Preflight plus production build. Catches build-only issues |
| Hunting dead code / before a big cleanup PR | `pnpm deadcode` | Runs `knip` — **read-only** — flagging unused files, exports, types, and dependencies. Its own CI job; NOT part of `preflight` |

If a new kind of validation is added, it goes into `preflight`. Don't document
bespoke chains like `biome check && tsc && vitest` elsewhere — they drift. Call
`pnpm preflight` and let the script definition be the source of truth.

## Editor Integration

Install the Biome extension for format-on-save. It eliminates most of the fixes
`pnpm check` would apply and keeps the pre-commit hook silent.

## Skipping the Pre-commit Hook

Do not. If the hook fails, fix the issue. If the hook itself is wrong, raise an
issue and fix the root cause. Never bypass with `--no-verify`.

## Dead-code check

`pnpm deadcode` runs [`knip`](https://knip.dev) (ADR-013) over the whole repo and
fails on:

- **Unused files** — a module nothing reachable imports.
- **Unused exports / types** — an `export` no other module imports.
- **Unused / unlisted dependencies** — a `package.json` dep imported nowhere, or
  an import with no declared dependency.

It runs as its own CI job (**Dead code**) on every PR. It is deliberately not
part of `pnpm preflight`; run it yourself before a cleanup PR or when something
looks orphaned.

Config lives in **`knip.jsonc`** — JSONC, so every entry point and ignore
carries an inline `//` comment explaining why. Read those comments before
changing the config.

### Handling a false positive

knip cannot see code reached dynamically. When it flags something live, **be
conservative — do not delete it.** Pick the narrowest fix and leave a rationale:

1. **A file-based route, a framework entry, or a whole vendored module** (e.g.
   `app/components/ui/**` shadcn source) → add an **entry** glob in `knip.jsonc`
   with a comment. Entry files' exports are treated as public API.
2. **A `*.fn.ts` server function** → already covered by the `app/**/*.fn.ts`
   entry glob (invoked via TanStack Start's generated server-fn manifest, which
   knip can't trace). No action needed.
3. **A single export reached dynamically** outside those globs — a server-fn
   seam in a non-`*.fn.ts` file, a compile-time drift-guard type, a test
   fixture — → tag the export `@knippublic` in a JSDoc/line comment **with a
   sentence saying why it has no importer**. The `tags: ["-knippublic"]` setting
   makes knip treat tagged exports as used. Grep `@knippublic` for examples.
4. **An unused dependency you must keep** → add it to `ignoreDependencies` in
   `knip.jsonc` with an inline comment.

Only when a finding is genuinely dead — not reached at runtime, not a route, not
an RPC/server-fn seam, not a test fixture — **delete it** (and any test that
exists only to exercise it). If a safe removal is large or risky, open a
follow-up issue instead of forcing it into an unrelated PR. Never delete
`db/migrations/**` or generated files (`app/routeTree.gen.ts`).
