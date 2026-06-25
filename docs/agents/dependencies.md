# Dependencies

Rules for adding, updating, and pinning packages in this repo.

## Range Strategy

| Range   | When to use                                    | Example                        |
| ------- | ---------------------------------------------- | ------------------------------ |
| `~x.y.z` | Tightly coupled packages where minor bumps break things (TanStack, Vinxi) | `~1.114.3` — allows `1.114.x` |
| `^x.y.z` | Stable libraries with reliable semver (React, Zod, Hono, Biome) | `^5.67.0` — allows `5.x.x`    |
| Exact   | Only when even patch releases have caused issues | `1.114.3` — no movement        |

Default to `^` for new dependencies. Switch to `~` if you encounter or have reason to expect breaking changes in minor releases.

## TanStack Override Pattern

TanStack Router, Start, and their internal sub-packages must stay on one
compatible release. If the lockfile resolves different sub-packages to
different minors, things break silently — for example, v1.167 dropped the
vinxi-based config API this project relies on (see PR #9), and a newer
`start-*-core` expecting `@tanstack/router-core` to export `./ssr/client` broke
`vinxi build` against the pinned `1.114` core (see PR #30).

The fix is the `pnpm.overrides` block in `package.json`. Two rules make it work:

1. **Pin to exact versions, not ranges.** A tilde (`~1.114.3`) lets each entry
   drift to a different `1.114.x` patch on a fresh resolve, which can reintroduce
   skew. Exact versions freeze a known-good set.
2. **List every internal package, not just the `@tanstack/react-*` ones.** This
   includes `start-client-core`, `start-server-core`, `start-server-functions-*`,
   `router-core`, `router-utils`, `history`, `virtual-file-routes`,
   `directive-functions-plugin`, etc. Any omitted package floats to its latest
   release and drags in newer, incompatible architecture. (This was the root
   cause fixed in #30.)

```jsonc
"pnpm": {
  "overrides": {
    "@tanstack/react-router": "1.114.35",
    "@tanstack/react-start": "1.114.34",
    "@tanstack/start-client-core": "1.114.35",
    "@tanstack/start-server-core": "1.114.35",
    // ... every router/start internal package, pinned exactly
  }
}
```

Note the versions are **not all identical** — within a single release line the
sub-packages publish different latest patches (e.g. `react-start` at `1.114.34`,
`router-utils` at `1.114.29`). Pin each to the exact version the set resolves to,
not to one shared number.

**When updating TanStack versions:**

1. Update **both** the top-level `dependencies`/`devDependencies` **and** every
   entry in `pnpm.overrides`, using the exact resolved version per package.
2. Run `pnpm install` and confirm the `pnpm-lock.yaml` diff shows a single,
   coherent set with no stray newer `@tanstack/*` minors.
3. Run `pnpm preflight && pnpm build`.

Never update just one TanStack package in isolation.

> Future cleanup: once TanStack Start stabilizes its internal package versioning
> (a single coordinated version), this whole block can collapse to a normal
> dependency range and be removed.

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

## Unused Dependency Check

CI runs [`knip`](https://knip.dev) via `pnpm knip` to fail the build when a
declared dependency is imported nowhere (or an import has no corresponding
dependency). This is the guardrail that would have caught `@tanstack/react-query`
sitting in the stack unused before it was wired up.

Config lives in `knip.json`. Three repo-specific settings keep false positives at zero:

- **Entry points** list the vinxi / TanStack Start entries (`app/client.tsx`,
  `app/ssr.tsx`, `app/router.tsx`, `app/routes/**`, `app/server/index.ts`) and the
  standalone scripts — knip can't infer the framework's entrypoints on its own.
- **`tailwindcss` is in `ignoreDependencies`** — it's consumed via
  `@import "tailwindcss"` in `app/styles/app.css` and the `@tailwindcss/vite`
  plugin, neither of which knip traces, so it would otherwise be a false "unused".
- **The drizzle plugin is disabled** (`"drizzle": false`) so knip doesn't execute
  `drizzle.config.ts` (which throws without `DATABASE_URL`). `drizzle-kit` is still
  detected via the `db:*` scripts.

Run it locally with `pnpm knip`. If knip flags a dependency you intend to keep
unused, add it to `ignoreDependencies` in `knip.json` and note why in this
section — don't silence the whole check.
