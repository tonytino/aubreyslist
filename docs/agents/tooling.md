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
| Hunting copy-paste duplication / validating a cleanup PR | `pnpm duplication` | Runs `jscpd` — **read-only** — detecting repeated code blocks by textual match. Its own CI job; NOT part of `preflight` |

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

## Duplication check

`pnpm duplication` runs [`jscpd`](https://github.com/kucherenko/jscpd) over `app/`,
`.github/scripts/`,
`db/`, and `scripts/` at `minTokens: 70` and fails on textual code clones
(copy-pasted blocks).

It runs as its own CI job (**Duplication**) on every PR, so new duplication fails
the build. It is deliberately **not** part of `pnpm preflight` (preflight is
lint + types + tests); run `pnpm duplication` yourself before a cleanup PR or when
you suspect repeated code.

Config lives in **`.jscpd.json`** at the repo root.

### Why test files are excluded

A baseline sweep **at `minTokens: 50`** found 164 clones. Of these, 149 were
test-to-test (tests repeat by design — arrange, act, assert). Only 15 were
source-to-source. Test duplication is acceptable and does not signal a real
problem, so tests are excluded.

Raising the floor to the shipped `minTokens: 70` and excluding tests left a
baseline of 8 clones. Those 8 were resolved before the gate was switched on: 6
were refactored away (4 into `scripts/cli.ts`, the other 2 into the
`IncidentFields` component and shared incident schemas) and 2 were accepted and
marked. The tree reports 0 clones today, so any clone the gate reports is new.

### Textual vs. semantic duplication

`jscpd` catches **textual** clones only — repeated source text. It cannot catch a
component re-implemented from scratch with different names and structure. That
**semantic** case (duplicate logic under different code) is covered by the
"Reuse / duplication" dimension in the adversarial review loop
(`docs/agents/orchestration.md`).

### Handling an accepted clone

Some duplication is correct. When the gate flags one of those, **be conservative
— do not delete code to make the gate quiet, and do not widen the `ignore`
globs** (a glob blinds the whole file, including future clones). Wrap the
narrowest possible span instead, and always leave a reason:

```ts
/* jscpd:ignore-start -- why this duplication is deliberate */
// ...the accepted clone...
/* jscpd:ignore-end */
```

Marking **one** side of a pair is enough. Grep `jscpd:ignore-start` to see every
clone the repo has consciously accepted. There are two today:

| Accepted clone | Why it stays |
| -------------- | ------------ |
| `app/server/flags/flags.fn.ts` ↔ `app/server/flags/index.ts` | The server-fn seam is client-callable; `index.ts` imports `db`. A schema used by `.validator()` runs client-side and is not strippable, so sharing it would pull the database into the browser bundle. |
| `scripts/refresh-seed-data.ts` ↔ `app/server/places.ts` | Two different Places API responses (searchText vs Place Details). They collide only because Google reuses field names. |

Before you add a marker, confirm the clone is actually still there. A marker
that suppresses nothing is worse than none: it silently exempts its whole span
from the gate forever.

Raising `minTokens` to silence a specific clone is the wrong fix. It weakens the
gate everywhere to solve one case.
