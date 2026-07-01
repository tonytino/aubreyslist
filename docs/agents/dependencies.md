# Dependencies

Rules for adding, updating, and pinning packages in this repo.

## Range Strategy

| Range   | When to use                                    | Example                        |
| ------- | ---------------------------------------------- | ------------------------------ |
| `~x.y.z` | Tightly coupled packages where minor bumps break things | `~1.2.3` — allows `1.2.x` |
| `^x.y.z` | Stable libraries with reliable semver (React, Zod, Hono, Biome) | `^5.67.0` — allows `5.x.x`    |
| Exact   | Only when even patch releases have caused issues | `1.2.3` — no movement          |

Default to `^` for new dependencies. Switch to `~` if you encounter or have reason to expect breaking changes in minor releases.

## TanStack packages (de-pinned — post-vinxi)

The `@tanstack/*` packages are on plain `^` ranges — there is **no
`pnpm.overrides` block for them** (removed in the vinxi→Vite-plugin migration,
issue #198, ADR-012).

**History (why the old exact-pin block existed and why it's gone).** Under vinxi
0.5 the project was pinned to TanStack Start `~1.114` via a ~25-entry
`pnpm.overrides` block that froze every internal sub-package
(`start-client-core`, `start-server-core`, `router-core`, `router-utils`,
`history`, …) to an exact `1.114.x` patch. That was load-bearing: TanStack Start
dropped the vinxi config API in v1.120, and any un-pinned sub-package floated to
a newer, incompatible architecture that broke `vinxi build`. Since v1.120 Start
is a **Vite plugin** and coordinates its own internal versions, so the exact-pin
block is obsolete — keeping it would have blocked the vite 6+/Start ≥1.167 bump
that clears the osv `vite`/`esbuild`/`start-server-core` advisory cluster.

**Range strategy today.** `@tanstack/react-router`, `@tanstack/react-start`,
`@tanstack/router-cli`, and `@tanstack/nitro-v2-vite-plugin` are on `^1.167`-style
ranges; the internal sub-packages resolve transitively (the plugin publishes them
as a coordinated set). Note the resolved versions are **not** all the same minor —
e.g. `react-start@1.168.x` depends on `react-router@1.170.x`,
`start-server-core@1.169.x`, `start-plugin-core@1.171.x`. That is expected and
coherent now; it is no longer skew to be frozen out.

**When updating TanStack versions:**

1. Bump the top-level `@tanstack/*` ranges in `package.json` together (never one
   in isolation).
2. Run `pnpm install` and inspect the `pnpm-lock.yaml` diff: confirm a single
   coherent set with **no leftover old-line packages** (e.g. no stray
   `@tanstack/start-server-core@1.114`, no `vinxi`). `pnpm why <pkg>` on any
   suspicious entry should trace to the current tree, not an orphan.
3. Run `pnpm preflight && pnpm build`, then replicate the CI `build-smoke` gate
   (`pnpm start` + the homepage/hydration/`/api/health` curls) — the framework
   entry wiring (`getRouter` in `app/router.tsx`, the `server.handlers` catch-all
   in `app/routes/api.$.ts`) is exactly what a bad bump breaks.

> Do **not** reintroduce an exact-pin `@tanstack/*` overrides block. If a future
> minor breaks the build, prefer bumping to a fixed version over freezing the
> whole set — the freeze is what created the vinxi upgrade debt in the first
> place.

### `@tanstack/start-storage-context` (devDep — server-fn test context)

`@tanstack/start-storage-context` is a **devDependency** used only by the
server-function unit-test helper (`tests/server-fn.ts`). Since v1.120 a
`createServerFn` call runs the framework middleware pipeline, which reads a
per-request context from `AsyncLocalStorage`; outside the server runtime that
store is empty and a bare call throws `No Start context found in
AsyncLocalStorage`. The helper wraps calls in `runWithStartContext` (from this
package) to supply a minimal context — it stubs nothing the function does. It's
listed as a knip entry (via `tests/server-fn.ts`) so it isn't flagged unused.

## Testing a Dependency Bump

```bash
# 1. Install and regenerate lockfile
pnpm install

# 2. Inspect lockfile for unexpected version drift
git diff pnpm-lock.yaml | grep "resolution:"

# 3. Validate
pnpm preflight && pnpm build

# 4. If E2E tests exist for the affected area
pnpm test:e2e
```

`pnpm preflight` is the single source of truth for validation — do not hand-roll a chain of `biome check && tsc && vitest` here, since the preflight script can evolve. If a new validation step is added, it is added to `preflight`, not documented here.

Review the `pnpm-lock.yaml` diff before committing. Large, unexplained changes in transitive dependencies are a red flag — investigate before pushing.

## Adding New Dependencies

Before adding a package:

1. **Check if the existing stack covers the need.** Zod handles validation, Hono handles HTTP, TanStack Query handles async state — don't add a redundant library.
2. **Prefer the standard library or built-in platform APIs.** If `URL`, `crypto.randomUUID()`, or `structuredClone` does the job, use it.
3. **Justify the addition.** If you add a new dependency, note why in the PR description.
4. **Prefer well-maintained, small packages** over large kitchen-sink libraries.
5. **Dev dependencies stay dev.** Test utilities, type packages, and build tools go in `devDependencies`.

The hard rule from `AGENTS.md` applies: **no new dependencies without checking if the existing stack already covers the need.**

### commitlint (devDeps, no-new-deps rule waived)

`@commitlint/cli` and `@commitlint/config-conventional` (both `devDependencies`)
hard-gate Conventional Commits — via a local `commit-msg` hook (Lefthook) and a
CI `pr-title` check against the squash-merge PR title. The "no new dependencies"
Hard Rule was **explicitly waived by the maintainer** for this; nothing in the
existing stack (Biome, Lefthook) parses or validates commit-message structure.
Config is in `commitlint.config.mjs`. knip's commitlint plugin auto-detects that
config, so these are not flagged as unused (no `ignoreDependencies` entry needed).

### UI layer: shadcn/ui + Phosphor (ADR-011)

Full shadcn/ui adoption brought in `class-variance-authority`, `clsx`,
`tailwind-merge`, `@radix-ui/react-slot`, and `@radix-ui/react-label` (component
machinery) plus `@phosphor-icons/react` (icons). All are runtime `dependencies`
(they ship in the client bundle). shadcn components are **copy-in source** under
`app/components/ui/`, not a package — so the only packages are the primitives'
building blocks. Add further `@radix-ui/*` primitives **per-component, on demand**
(when adding a dialog, popover, dropdown, etc.) — never speculatively. See
ADR-011 and `docs/agents/styling.md` for the import conventions (notably:
Phosphor must be imported from `@phosphor-icons/react/dist/ssr`).

## Unused Dependency Check

CI runs [`knip`](https://knip.dev) via `pnpm knip` to fail the build when a
declared dependency is imported nowhere (or an import has no corresponding
dependency). This is the guardrail that would have caught `@tanstack/react-query`
sitting in the stack unused before it was wired up.

Config lives in `knip.json`. Three repo-specific settings keep false positives at zero:

- **Entry points** list the TanStack Start Vite-plugin entries (`app/client.tsx`,
  `app/router.tsx`, `app/routes/**`, `app/server/index.ts`) plus the server-fn
  test helper (`tests/server-fn.ts`) and the standalone scripts — knip can't infer
  the framework's entrypoints on its own. (`vite.config.ts` is auto-detected by
  knip's vite plugin, so it is not listed. The old vinxi `app/ssr.tsx` / `app/api.ts`
  entries were removed in the migration — issue #198.)
- **`tailwindcss` is in `ignoreDependencies`** — it's consumed via
  `@import "tailwindcss"` in `app/styles/app.css` and the `@tailwindcss/vite`
  plugin, neither of which knip traces, so it would otherwise be a false "unused".
- **The drizzle plugin is disabled** (`"drizzle": false`) so knip doesn't execute
  `drizzle.config.ts` (which throws without `DATABASE_URL`). `drizzle-kit` is still
  detected via the `db:*` scripts.

Run it locally with `pnpm knip`. If knip flags a dependency you intend to keep
unused, add it to `ignoreDependencies` in `knip.json` and note why in this
section — don't silence the whole check.
