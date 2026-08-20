# Dependencies

Rules for adding, updating, and pinning packages in this repo.

## Range Strategy

| Range   | When to use                                    | Example                        |
| ------- | ---------------------------------------------- | ------------------------------ |
| `~x.y.z` | Tightly coupled packages where minor bumps break things | `~1.2.3` — allows `1.2.x` |
| `^x.y.z` | Stable libraries with reliable semver (React, Zod, Hono, Biome) | `^5.67.0` — allows `5.x.x`    |
| Exact   | Only when even patch releases have caused issues | `1.2.3` — no movement          |

Default to `^` for new dependencies. Switch to `~` if you encounter or have reason to expect breaking changes in minor releases.

> **Where overrides live.** Dependency `overrides` (and the rest of the pnpm
> settings) are in **`pnpm-workspace.yaml`**, not the `pnpm.overrides` field in
> `package.json` — pnpm 11 no longer reads the latter. References to a
> `pnpm.overrides` block below are historical.

## Security advisories vs. the release-age quarantine

Two rules in this repo pull in opposite directions, and the resolution is
automated so you should rarely have to think about it:

- **`minimumReleaseAge: 10080`** in `pnpm-workspace.yaml` (mirrored by
  `cooldown: default-days: 7` in `.github/dependabot.yml`) stops pnpm installing
  any version less than 7 days old, transitive deps included. A compromised
  release is usually caught within days of publish, so the quarantine is the
  main defence against a publish-then-attack supply-chain compromise.
- **The `Dependency vulns (osv-scanner)` CI gate** wants every known advisory
  fixed *now*.

When an advisory lands, its fix is brand new — so for up to a week CI would
demand an upgrade pnpm is configured to refuse. **`.github/scripts/check-osv.mjs`
reconciles the two.** For each finding it looks up when the fixed version was
published and asks whether pnpm could install it yet:

| Situation | What CI does |
| --- | --- |
| Fix is still inside the 7-day quarantine | `::warning::`, **build stays green**, job summary records the unblock date |
| Quarantine has lapsed | `::error::`, build fails — the fix is installable, so install it |
| No fixed version published at all | `::error::` — there is nothing to wait for |
| CVSS **Critical** (≥ 9.0) | `::error::` regardless of the quarantine |

The deferral is self-expiring: nobody has to remember to come back, because the
gate turns red on its own the day the quarantine lapses. **A deferred warning is
not a to-do** — just let it age out and take the bump when it goes red.

**When you do have to intervene:**

- *A Critical, or something you need before the quarantine lapses* — fast-track
  that one version with a `minimumReleaseAgeExclude` entry in
  `pnpm-workspace.yaml`. Follow the shape of the existing entry: name the exact
  `package@version`, the CVE, the publish and window-clear dates, who approved
  it, and a Linear issue tracking its **removal**. This is deliberately
  high-friction — it is the exact hole the quarantine exists to close.
- *No fix exists, or the advisory doesn't apply to us* — add a reviewed waiver to
  **`osv-scanner.toml`** with an `ignoreUntil` expiry and a written reason. See
  that file's header.

Both files are owner-gated (`.github/CODEOWNERS`), so either route is a
`safe:human` PR — accepting or fast-tracking a vulnerability is the owner's call.

**Bumping a package that a security floor pins.** Several `overrides` entries in
`pnpm-workspace.yaml` are security floors. A floor written as `^x.y.z` does *not*
pull a new patch on its own — pnpm keeps the existing lockfile resolution — so
clearing an advisory usually means raising the floor itself, then re-resolving.

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

### UI layer: shadcn/ui + lucide-react (ADR-011)

Full shadcn/ui adoption brought in `class-variance-authority`, `clsx`,
`tailwind-merge`, `@radix-ui/react-slot`, and `@radix-ui/react-label` (component
machinery) plus `lucide-react` (icons — this superseded `@phosphor-icons/react`
in AUB-61). All are runtime `dependencies` (they ship in the client bundle).
shadcn components are **copy-in source** under `app/components/ui/`, not a package
— so the only packages are the primitives' building blocks. Add further
`@radix-ui/*` primitives **per-component, on demand** (when adding a dialog,
popover, dropdown, etc.) — never speculatively. See ADR-011 and
`docs/agents/styling.md` for the icon import conventions (lucide is imported from
the `"lucide-react"` barrel — it is SSR-safe, no special entrypoint needed).

### Maps: @vis.gl/react-google-maps (AUB-111, sanctioned)

`@vis.gl/react-google-maps` (runtime `dependency`, `^1.8.3`) renders the
directory Map view's REAL Google map — it is Google's endorsed React wrapper
for the Maps JavaScript API (`APIProvider`/`Map`/`AdvancedMarker`), and nothing
in the existing stack renders map tiles. The "no new dependencies" Hard Rule
was satisfied via the AUB-111 issue explicitly sanctioning it. Its companion
`@types/google.maps` is a `devDependency` (ambient `google.maps.*` namespace;
listed in tsconfig `types` because automatic `@types` inclusion is off). Note
the 1.9.0 line was quarantined by `minimumReleaseAge` at adoption time
(published < 7 days prior); bump the range once it matures if needed. The map
is key-gated at runtime (`VITE_GOOGLE_MAPS_BROWSER_KEY`,
`docs/agents/environment.md`) with a CSS-placeholder fallback, so the
dependency is inert in keyless environments.

## Unused Dependency Check

The unused-dependency guard is now one facet of the repo's full dead-code check
([`knip`](https://knip.dev), ADR-013). CI runs `pnpm deadcode` to fail the build
when a declared dependency is imported nowhere (or an import has no corresponding
dependency) — **plus** when a file becomes unreachable or an export/type goes
unused. This is the guardrail that would have caught `@tanstack/react-query`
sitting in the stack unused before it was wired up.

For the full config model, entry-point rationale, and how to handle false
positives (`@knippublic` tags, entry globs, ignores), see
**`docs/agents/tooling.md` → Dead-code check**. Config lives in `knip.jsonc`
(JSONC so every entry/ignore carries an inline `//` rationale).

The dependency-specific rules: `tailwindcss` and `tw-animate-css` are in
`ignoreDependencies` (consumed via CSS `@import`, which knip doesn't trace), and
the drizzle plugin is disabled (`"drizzle": false`) so knip doesn't execute
`drizzle.config.ts` (which throws without `DATABASE_URL`; `drizzle-kit` is still
detected via the `db:*` scripts).

Run it locally with `pnpm deadcode`. If knip flags a dependency you intend to
keep unused, add it to `ignoreDependencies` in `knip.jsonc` with an inline
comment saying why — don't silence the whole check.
