# Dependencies

Rules for adding, updating, and pinning packages.

## Range Strategy

| Range   | When to use                                    | Example                        |
| ------- | ---------------------------------------------- | ------------------------------ |
| `~x.y.z` | Tightly coupled packages where minor bumps break things | `~1.2.3` — allows `1.2.x` |
| `^x.y.z` | Stable libraries with reliable semver (React, Zod, Hono, Biome) | `^5.67.0` — allows `5.x.x`    |
| Exact   | Only when even patch releases have caused issues | `1.2.3` — no movement          |

Default to `^` for new dependencies. Switch to `~` on evidence of breaking
minor releases.

> **Where overrides live.** Dependency `overrides` (and the rest of the pnpm
> settings) are in **`pnpm-workspace.yaml`** — pnpm 11 no longer reads
> `package.json`'s `pnpm.overrides` field.

## Security advisories vs. the release-age quarantine

Two rules pull in opposite directions; the resolution is automated:

- **`minimumReleaseAge: 10080`** in `pnpm-workspace.yaml` (mirrored by
  `cooldown: default-days: 7` in `.github/dependabot.yml`) stops pnpm installing
  any version less than 7 days old, transitives included — the main defence
  against a publish-then-attack supply-chain compromise.
- **The `Dependency vulns (osv-scanner)` CI gate** wants every known advisory
  fixed now.

**`.github/scripts/check-osv.mjs` reconciles the two.** For each finding it
looks up when the fixed version was published and whether pnpm could install it
yet:

| Situation | What CI does |
| --- | --- |
| Fix is still inside the 7-day quarantine | `::warning::`, **build stays green**, job summary records the unblock date |
| Quarantine has lapsed | `::error::`, build fails — the fix is installable, so install it |
| No fixed version published at all | `::error::` — there is nothing to wait for |
| CVSS **Critical** (≥ 9.0) | `::error::` regardless of the quarantine |

The deferral is self-expiring: the gate turns red on its own the day the
quarantine lapses. **A deferred warning is not a to-do** — let it age out and
take the bump when it goes red.

**When you do have to intervene:**

- *A Critical, or something needed before the quarantine lapses* — fast-track
  that one version with a `minimumReleaseAgeExclude` entry in
  `pnpm-workspace.yaml`. Follow the shape that file's comment describes: the
  exact `package@version`, the CVE, the publish and window-clear dates, who
  approved it, and a Linear issue tracking its **removal**. Deliberately
  high-friction.
- *No fix exists, or the advisory doesn't apply* — add a reviewed waiver to
  **`osv-scanner.toml`** with an `ignoreUntil` expiry and a written reason. See
  that file's header.

Both files are owner-gated (`.github/CODEOWNERS`), so either route is a
`safe:human` PR — accepting or fast-tracking a vulnerability is the owner's
call.

**Bumping a package that a security floor pins.** Several `overrides` entries in
`pnpm-workspace.yaml` are security floors. A floor written as `^x.y.z` does
*not* pull a new patch on its own — pnpm keeps the existing lockfile resolution
— so clearing an advisory usually means raising the floor itself, then
re-resolving.

## TanStack packages

The `@tanstack/*` packages are on plain `^` ranges (e.g. `^1.167`) with **no
overrides block** — since v1.120 Start is a Vite plugin that coordinates its
own internal sub-package versions, which resolve transitively. The resolved
versions are **not** all the same minor (e.g. `react-start@1.168.x` depends on
`react-router@1.170.x`) — that is expected and coherent, not skew to freeze.

**When updating TanStack versions:**

1. Bump the top-level `@tanstack/*` ranges in `package.json` together
   (`react-router`, `react-start`, `router-cli`, `nitro-v2-vite-plugin`) —
   never one in isolation.
2. Run `pnpm install` and inspect the `pnpm-lock.yaml` diff: confirm a single
   coherent set with no leftover old-line packages (e.g. no stray
   `@tanstack/start-server-core@1.114`, no `vinxi`). `pnpm why <pkg>` on any
   suspicious entry should trace to the current tree, not an orphan.
3. Run `pnpm preflight && pnpm build`, then replicate the CI `build-smoke` gate
   (`pnpm start` + the homepage/hydration/`/api/health` curls) — the framework
   entry wiring (`getRouter` in `app/router.tsx`, the `server.handlers`
   catch-all in `app/routes/api.$.ts`) is exactly what a bad bump breaks.

> Do **not** introduce an exact-pin `@tanstack/*` overrides block. If a future
> minor breaks the build, bump to a fixed version rather than freezing the
> whole set — a freeze accumulates upgrade debt.

### `@tanstack/start-storage-context` (devDep — server-fn test context)

Used only by the server-function unit-test helper (`tests/server-fn.ts`). A
`createServerFn` call runs the framework middleware pipeline, which reads a
per-request context from `AsyncLocalStorage`; outside the server runtime that
store is empty and a bare call throws `No Start context found in
AsyncLocalStorage`. The helper wraps calls in `runWithStartContext` to supply a
minimal context — it stubs nothing the function does. Listed as a knip entry
(via `tests/server-fn.ts`) so it isn't flagged unused.

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

`pnpm preflight` is the single source of truth for validation — do not
hand-roll `biome check && tsc && vitest` chains; new validation steps go into
`preflight`, not this doc.

Review the `pnpm-lock.yaml` diff before committing. Large, unexplained changes
in transitive dependencies are a red flag — investigate before pushing.

## Adding New Dependencies

Before adding a package:

1. **Check if the existing stack covers the need.** Zod handles validation,
   Hono handles HTTP, TanStack Query handles async state.
2. **Prefer the standard library or built-in platform APIs** (`URL`,
   `crypto.randomUUID()`, `structuredClone`).
3. **Justify the addition** in the PR description.
4. **Prefer well-maintained, small packages** over kitchen-sink libraries.
5. **Dev dependencies stay dev.** Test utilities, type packages, and build
   tools go in `devDependencies`.

The hard rule from `AGENTS.md` applies: **no new dependencies without checking
if the existing stack already covers the need.**

### commitlint (devDeps, no-new-deps rule waived)

`@commitlint/cli` and `@commitlint/config-conventional` (both
`devDependencies`) hard-gate Conventional Commits — via a local `commit-msg`
hook (Lefthook) and the CI `pr-title` check. The "no new dependencies" Hard
Rule was **explicitly waived by the maintainer**: nothing in the existing stack
validates commit-message structure. Config: `commitlint.config.mjs`. knip's
commitlint plugin auto-detects it (no `ignoreDependencies` entry needed).

### UI layer: shadcn/ui + lucide-react (ADR-011)

shadcn/ui brings `class-variance-authority`, `clsx`, `tailwind-merge`,
`@radix-ui/react-slot`, and `@radix-ui/react-label` (component machinery) plus
`lucide-react` (icons). All are runtime `dependencies` (they ship in the client
bundle). shadcn components are **copy-in source** under `app/components/ui/`,
not a package. Add further `@radix-ui/*` primitives **per-component, on
demand** — never speculatively. See ADR-011 and `docs/agents/styling.md` for
icon conventions (lucide is imported from the `"lucide-react"` barrel — it is
SSR-safe).

### Maps: @vis.gl/react-google-maps (AUB-111, sanctioned)

`@vis.gl/react-google-maps` (runtime `dependency`, `^1.8.3`) renders the
directory Map view's real Google map — Google's endorsed React wrapper for the
Maps JavaScript API (`APIProvider`/`Map`/`AdvancedMarker`); nothing in the
existing stack renders map tiles. The "no new dependencies" Hard Rule was
satisfied via AUB-111 explicitly sanctioning it. Companion
`@types/google.maps` is a `devDependency` (ambient `google.maps.*` namespace;
listed in tsconfig `types` because automatic `@types` inclusion is off). The
map is key-gated at runtime (`VITE_GOOGLE_MAPS_BROWSER_KEY`,
`docs/agents/environment.md`) with a CSS-placeholder fallback, so the
dependency is inert in keyless environments.

## Unused Dependency Check

The unused-dependency guard is one facet of the repo's dead-code check
([`knip`](https://knip.dev), ADR-013). CI runs `pnpm deadcode` to fail the
build when a declared dependency is imported nowhere (or an import has no
declared dependency), plus unreachable files and unused exports/types.

For the config model, entry-point rationale, and false-positive handling
(`@knippublic` tags, entry globs, ignores), see
**`docs/agents/tooling.md` → Dead-code check**. Config lives in `knip.jsonc`
(JSONC so every entry/ignore carries an inline `//` rationale).

Dependency-specific rules: `tailwindcss` and `tw-animate-css` are in
`ignoreDependencies` (consumed via CSS `@import`, which knip doesn't trace),
and the drizzle plugin is disabled (`"drizzle": false`) so knip doesn't execute
`drizzle.config.ts` (which throws without `DATABASE_URL`; `drizzle-kit` is
still detected via the `db:*` scripts).

Run it locally with `pnpm deadcode`. To keep a dependency knip flags, add it to
`ignoreDependencies` in `knip.jsonc` with an inline comment saying why — don't
silence the whole check.
