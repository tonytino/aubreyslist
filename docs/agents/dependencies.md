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

TanStack Router, Start, and their internal sub-packages release in lockstep. If the lockfile resolves different sub-packages to different minors, things break silently — for example, v1.167 dropped the vinxi-based config API that this project relies on (see PR #9).

The fix is the `pnpm.overrides` block in `package.json`, which pins **every** `@tanstack/*` router/start package to the same tilde range:

```jsonc
"pnpm": {
  "overrides": {
    "@tanstack/react-router": "~1.114.3",
    "@tanstack/react-start": "~1.114.3",
    "@tanstack/react-start-client": "~1.114.3",
    // ... all sub-packages at the same version
  }
}
```

**When updating TanStack versions:**

1. Change the version in **both** the top-level `dependencies`/`devDependencies` **and** every entry in `pnpm.overrides`.
2. Run `pnpm install` and verify the lockfile shows a single resolved version for all `@tanstack/*` packages.
3. Run the full preflight (`pnpm check && pnpm typecheck && pnpm test && pnpm build`).

Never update just one TanStack package in isolation.

## Testing a Dependency Bump

```bash
# 1. Install and regenerate lockfile
pnpm install

# 2. Inspect lockfile for unexpected version drift
git diff pnpm-lock.yaml | grep "resolution:"

# 3. Run preflight
pnpm check && pnpm typecheck && pnpm test && pnpm build

# 4. If E2E tests exist for the affected area
pnpm test:e2e
```

Review the `pnpm-lock.yaml` diff before committing. Large, unexplained changes in transitive dependencies are a red flag — investigate before pushing.

## Adding New Dependencies

Before adding a package:

1. **Check if the existing stack covers the need.** Zod handles validation, Hono handles HTTP, TanStack Query handles async state — don't add a redundant library.
2. **Prefer the standard library or built-in platform APIs.** If `URL`, `crypto.randomUUID()`, or `structuredClone` does the job, use it.
3. **Justify the addition.** If you add a new dependency, note why in the PR description.
4. **Prefer well-maintained, small packages** over large kitchen-sink libraries.
5. **Dev dependencies stay dev.** Test utilities, type packages, and build tools go in `devDependencies`.

The hard rule from `AGENTS.md` applies: **no new dependencies without checking if the existing stack already covers the need.**
