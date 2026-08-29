# CI Guardrails — Portable Handoff Reference

This document describes every CI check that gates a pull request in this
repository, plus the design patterns that make them work, so that **an agent
with no access to this repo** can replicate the same level of enforcement in a
different codebase. It is deliberately self-contained: thresholds, config
values, and the reasoning behind each choice are inlined rather than referenced.

Audience: an AI coding agent (or engineer) setting up guardrails in another
repository — likely a different stack, org, and toolchain. Sections are split
into **what the check enforces** (portable) and **how this repo implements it**
(adapt per stack).

Source of truth if you *do* have repo access: `.github/workflows/`,
`.github/scripts/`, and the config files named throughout.

---

## 1. The philosophy: why this CI surface exists

This is an **agent-first** repository: most code is written by AI agents
working in parallel sessions, reviewed by other agents, and often merged
without a human in the loop. That model only works if the owner's standards
are **mechanically enforced** rather than remembered. Every rule that matters
is encoded as a CI gate, because:

1. **Prose rules decay; gates don't.** A convention documented in a
   contributing guide is followed until the first agent (or engineer) who
   didn't read it. A required status check is followed forever.
2. **Agents optimize for green.** If the only way to get a green build is to
   write tests, cover changed lines, avoid duplication, and keep dead code
   out, agents do exactly that. The CI surface *is* the spec of "acceptable
   work" — code quality expectations manifest as checks, not as review
   comments.
3. **Trust the output, not the promise.** Several gates verify artifacts
   (the built client bundle, the generated migrations, the coverage report)
   rather than trusting that a process was followed.
4. **Guardrails must protect themselves.** The CI config, workflows, and guard
   scripts are owner-review-gated, so weakening a gate requires the owner's
   own sign-off (see §5).

The guardrails are layered — each layer backstops the one before it:

| Layer | Mechanism | Catches |
| --- | --- | --- |
| Local, pre-commit | git hooks (lint staged files, lint commit message) | fast feedback before anything is pushed |
| Local, pre-handoff | one command running lint + typecheck + tests (`pnpm preflight` here) | "done" declared without validation |
| CI, per-PR | the required checks in §3–§4 | everything else, mechanically |
| Repo settings | branch protection / rulesets + CODEOWNERS | merges that bypass CI or owner review |
| Process-in-CI | label, PR-body, and review-record gates | workflow steps (review, changelog, classification) skipped |

---

## 2. Cross-cutting conventions (copy these first)

These patterns apply to *every* workflow below and are the highest-leverage
things to port — they are stack-agnostic.

**All checks are required, and required checks must always report.**
Every job below is intended to be a required status check on the default
branch. Corollary: a required check must produce a result on *every* PR.
Path-filtered triggers (`on.pull_request.paths:`) break this — a PR outside
the paths never reports, the required check sits at "Expected" forever, and
the merge is blocked. So expensive conditional gates (mutation testing,
preview-DB migration) instead run on every PR and make the **relevance
decision inside the job**: a first step lists the PR's changed files, and if
none are relevant, later steps skip and the job reports success. The
changed-file listing retries 3× on API failure and **fails rather than
skipping** if it can't be determined — a gate must never silently pass because
of infrastructure trouble.

**Secret-gated steps skip gracefully; security gates fail closed.**
Checks that need optional infrastructure (a CI database, a Neon API key)
detect the secret in a step and skip the dependent steps with a `::warning::`
when absent — the job still succeeds, so the repo works before secrets are
provisioned and on forks (where secrets are withheld). The opposite posture
applies to security gates: if the vulnerability scanner's output is missing or
unparseable, or the registry can't be reached, the gate **fails** — a security
check that goes quiet when it cannot verify is worse than a noisy one.

**Untrusted PR content never touches the shell inline.**
PR titles, bodies, and label names are attacker-controlled (anyone can open a
PR). They are always passed to scripts via environment variables
(`env: PR_BODY: ${{ github.event.pull_request.body }}`), never interpolated
into `run:` commands — inline `${{ }}` interpolation of PR content is a shell
injection vector.

**Least-privilege permissions, explicitly.**
Workflows declare `permissions: {}` or `permissions: contents: read` at the
top and opt individual jobs into exactly what they need (e.g. CodeQL's job
alone gets `security-events: write`). Never rely on the default token scope.

**Every third-party action is pinned to a commit SHA** with a trailing
`# vX.Y.Z` comment (e.g. `actions/checkout@3d3c42e5...` `# v7.0.1`). Tags are
mutable; SHAs are not. Dependabot's `github-actions` ecosystem preserves the
pinning when it bumps versions.

**Concurrency groups cancel superseded runs.** Each workflow sets
`concurrency: group: <workflow>-<ref>` with `cancel-in-progress: true`
(exception: DB-migration jobs serialize with `cancel-in-progress: false` —
never cancel a half-applied migration; and merge-triggered jobs that fire once
need no group).

**Custom guard scripts are zero-dependency and unit-tested.**
Repo-specific gates (§4) are plain Node ESM scripts under `.github/scripts/`
with **no npm dependencies** — they must run even when `install` itself is
broken, and they add no supply-chain surface. Each exports its matching logic
as pure functions (content in → findings out) with the IO in `main()`, and has
a unit test suite in the repo's normal test tree, so the guards themselves are
covered by the coverage gates. Failures print GitHub error annotations
(`::error file=<path>,line=<n>::<message with a one-line remedy>`) so findings
land inline in the PR diff, and collect *all* violations before exiting 1 (no
fail-fast — one run shows everything to fix).

**Fast checks are parallel, self-contained jobs.** Lint, typecheck, dead code,
duplication, and unit tests each run as their own job repeating the same
4-step setup (checkout → package-manager setup → runtime setup with lockfile
cache → frozen-lockfile install). Wall-clock time is the longest single job,
not the sum, and one failure never hides another.

**Version-pin the toolchain from files, not workflow text.** Node version
comes from `.nvmrc`; the package-manager version comes from the `packageManager`
field in `package.json`; installs use `--frozen-lockfile`. CI and local runs
cannot drift.

---

## 3. Code-quality gates (the "keep agents honest" core)

These are the checks that most directly enforce quality standards. All run in
one workflow (`ci.yml`) on every PR and every push to `main`.

### 3.1 Lint + format — one job, autofix locally, check-only in CI

- **Enforces:** zero lint errors, zero formatting drift. There is no "warning"
  tier — the linter's findings fail the build.
- **Here:** Biome (`biome check .`) covers linting *and* formatting in one
  tool. Equivalent: ESLint + Prettier with `--max-warnings=0` and
  `prettier --check`.
- The same tool runs locally in autofix mode (`pnpm check`) and in a
  pre-commit hook on staged files, so CI failures of this class are rare.

### 3.2 Type check

- **Enforces:** the strictest practical compiler settings, no suppressed
  errors. `tsc --noEmit` with `strict: true`; the repo also bans `any` and
  unexplained `@ts-ignore`/`@ts-expect-error` (enforced separately — §4.1).

### 3.3 Dead code — fail the PR on unused anything

- **Enforces:** no unused files (unreachable modules), no unused
  exports/types, no unused or undeclared dependencies. This is a **regression
  guard**: a one-time sweep cleaned the repo, and this check keeps entropy
  from re-accumulating — agents love to leave orphaned helpers behind.
- **Here:** [knip](https://knip.dev) with a checked-in `knip.jsonc`. The
  config-file discipline is the transferable part:
  - Use the commented config format (JSONC) so **every ignore carries an
    inline rationale** — an unexplained ignore list rots into a bypass.
  - List framework entry points explicitly (file-based routes, server-function
    seams, codegen consumers) — anything reached dynamically that static
    analysis can't trace.
  - Handle false positives with a tagged escape hatch (`@knippublic` on the
    export + a why-comment) rather than widening globs.
- Equivalent for other stacks: knip (JS/TS), `deptry`/`vulture` (Python),
  `deadcode` (Go), compiler warnings promoted to errors.

### 3.4 Copy-paste duplication — fail the PR on any clone

- **Enforces:** no textual copy-paste above a measured token floor, across all
  production source (`app`, `db`, `scripts`, and the CI guard scripts
  themselves).
- **Here:** [jscpd](https://github.com/kucherenko/jscpd) with `.jscpd.json`:
  - `minTokens: 70`, **measured, not guessed**: at 50 tokens, 149 of 164
    findings were test-to-test noise (arrange/act/assert repeats by design).
    Calibrate on your codebase — run the sweep at several floors and pick the
    one where findings are real.
  - `threshold: 0` — any clone at all exits non-zero. No percentage budget to
    slowly spend.
  - **Tests are ignored** (deliberate repetition), as are generated files.
  - Accepting a specific clone requires wrapping it in
    `jscpd:ignore-start`/`end` comments **with a reason** — never widening the
    ignore globs.
- **Honest limitation, worth repeating in your docs:** a token-based tool only
  catches *literal* copy-paste. The semantic case — "an equivalent helper
  already exists, you rewrote it" — needs code review (here: the agent review
  panel, §6, plus a hard rule that new components/hooks/utilities require
  searching for an existing one first).

### 3.5 Unit tests + test honesty

- The fast unit/component suite runs DB-free on every PR
  (`vitest run --allowOnly=false`, excluding the integration tree which runs
  in its own DB-gated job).
- `--allowOnly=false` makes a committed focused test (`.only`) **fail** the
  run instead of silently disabling its siblings — asserted explicitly even
  though CI mode implies it (belt and suspenders with the static scan in
  §4.1).

### 3.6 Diff coverage — 80% of *changed* lines, always on

The single most effective "agents must write tests" gate.

- **Enforces:** ≥ 80% of the executable lines a PR adds or changes must be
  executed by tests. Only changed lines are measured, so untested legacy code
  is never retroactively failed — the gate is safe to introduce on any
  existing tree, immediately.
- **Mechanics (portable to any coverage format):**
  1. Run the test suite with coverage, emitting a machine-readable per-line
     report (Istanbul-style `coverage-final.json` here).
  2. `git diff --unified=0 <merge-base>...HEAD` → the set of added/changed
     line numbers per file (three-dot diff so pre-existing commits on the base
     branch don't count against the PR).
  3. Intersect: every changed line that the report marks *coverable* is gated;
     covered/total must clear the threshold. Non-executable changed lines
     (blanks, comments, types) are ignored. Each uncovered line gets an inline
     `::error file=…,line=…::` annotation.
- **Two-mode design** (adopt if part of your suite needs infrastructure):
  when the optional CI database secret is present, coverage comes from the
  full suite (unit + integration) and *everything* is gated; when absent, the
  DB-only server paths are excluded from the gate and the exclusion is
  **logged loudly** — never silently. The gate itself always runs.
- **Backstopped by an absolute floor:** diff coverage alone lets aggregate
  coverage decay across many individually-compliant PRs, so whole-repo
  thresholds (here: statements 89 / branches 85 / functions 83 / lines 89,
  set ~2–3 points under the measured baseline as headroom) fail the coverage
  run outright if the aggregate drops. Ratchet the floor up over time;
  **never lower it to make a failing PR pass** (write that sentence into the
  config comment).

### 3.7 Mutation testing — do the tests *catch* bugs? (scoped)

- **Enforces:** on the highest-stakes pure-logic modules, the test suite must
  kill ≥ N% of injected mutants. Diff coverage proves changed lines execute;
  mutation testing proves the tests would fail if the logic broke.
- **Here:** Stryker (`stryker.conf.json`), scoped to the trust-scoring
  modules, the dedup matcher, and the rate limiter — mutation runs are
  expensive, so scope to the modules where a silent logic bug hurts most
  (for a work repo: billing math, permissions, core domain calculations).
- The job runs on every PR but only does the expensive work when the scoped
  paths (or the gate's own config) changed — the in-job relevance pattern
  from §2.
- **Threshold discipline (the transferable part):** the `break` threshold is
  set from a *measured* baseline with a small explicit buffer (measured
  95.78% → break 94), and the config comment documents every surviving mutant
  with the reason it survives (provably equivalent, environment-unkillable,
  or a judgment call). A threshold nobody can explain becomes a number people
  lower.

### 3.8 Production build smoke — trust the artifact

- **Enforces:** the production build completes, serves, and is wired
  correctly. `pnpm dev` working proves little about the real build.
- Steps worth copying, adapted to your framework:
  1. Build for production.
  2. **Grep the built client assets for forbidden tokens** — here, any
     database/driver identifier (`@neondatabase`, `drizzle-orm/neon-http`,
     `DATABASE_URL`) in the browser bundle fails the build. This catches an
     entire class of "server code leaked to the client" regressions at the
     artifact level, independent of how the leak happened. The guard also
     fails if the expected asset directory is missing, so a build-layout
     change can't silently disable it.
  3. Boot the built server and assert: the page returns 200, the stylesheet
     `<link>` resolves, the client-entry `<script type="module">` is present
     *and its bundle resolves* (SSR can look fine while hydration is dead —
     a no-JS site), and a DB-free API health endpoint returns 200 (catches
     the API router silently falling through to 404).
  - Smoke a **static, DB-free route** that still renders the full app shell,
    so the check needs no secrets.

### 3.9 Accessibility — always-on, isolated lane

- **Enforces:** zero axe-core violations on the public static pages, on every
  PR. Runs as its own workflow so it is DB-free and never entangled with the
  secret-gated E2E lane (and never double-counted by it).
- **Here:** Playwright project running `@axe-core/playwright` specs against
  the dev server. Treat accessibility as a product gate, not a nice-to-have —
  it's cheap once wired.

### 3.10 Integration + E2E (secret-gated) and DB-schema sync

- Integration tests and browser E2E run against a persistent CI database
  branch when the `CI_E2E_DATABASE_URL` secret exists; they self-skip
  without it (the suites check for the env var and `describe.skipIf`).
- **Migrations race guard:** a dedicated `db-migrate` job applies migrations
  exactly once *before* the parallel DB-touching jobs (`needs: [db-migrate]`),
  because concurrent suites each running `migrate()` race on brand-new
  migrations. It then runs a **verify step** asserting every migration in the
  journal is actually recorded as applied — guarding the migrator's silent-skip
  failure mode (a renumbered migration can be skipped forever while `migrate`
  exits 0).
- **Generated-code sync gate:** regenerate migrations from the schema in CI
  and fail on `git status --porcelain` output — catches both a hand-edited
  migration *and* a schema change whose migration was never generated
  (`git diff --exit-code` alone misses untracked new files). Apply the same
  pattern to any committed generated artifact (API clients, GraphQL types,
  protobufs): regenerate in CI, fail on drift.

---

## 4. Repo-rule gates (custom zero-dep guard scripts)

The repo's hard rules — the non-negotiables from its agent instructions — are
each enforced by a small script (see §2 for the script conventions). The
specific rules are stack-specific; the **pattern** is: *every prose rule you
find yourself repeating in code review becomes a ~50-line static check.*

### 4.1 Hard-rules scan (`check-hard-rules.mjs`)

Line-based static matchers over the source tree, one per rule:

| Rule | Matcher sketch | Scope |
| --- | --- | --- |
| No `process.env` outside the validated env accessor module | `/process\.env\b/` | app runtime code, minus the accessor + tests |
| No bare `@ts-ignore` / `@ts-expect-error` | directive with no trailing explanation text | all TS source |
| No DB value-imports in client-surface code | import specifier matches the DB/ORM/driver modules; `import type` allowed | components + routes, minus server seams |
| No raw `fetch()` against the internal API from the frontend (use the typed RPC client) | bare `fetch(` + `/api` literal on the same line | client surface |
| Test honesty: no `.only`, no `.skip("name"…)`, no `.todo` | per-token regexes; conditional `skip(cond)` / `skipIf` allowed | test files |

Deliberately simple line matchers — no AST, no comment-stripping — with the
known false-positive modes documented in the script header, because each rule
has an **authoritative backstop** elsewhere (the client-bundle grep in §3.8,
Vitest's `allowOnly=false` in §3.5). Cheap heuristic in front, artifact-level
truth behind: that pairing is the design.

### 4.2 Conventions gates (`pr-conventions.yml`)

A separate workflow because it must re-run on events the main CI ignores:
`edited` (title/body fixed) and `labeled`/`unlabeled` — with the default
trigger these checks would run once at open, before labels exist, and never
re-evaluate. Trigger list:
`types: [opened, edited, reopened, synchronize, labeled, unlabeled]`.

- **Conventional-Commit PR title** — squash-merge promotes the PR title to
  the commit message, so the title is linted with commitlint using the same
  config as the local `commit-msg` hook (types: feat, fix, chore, docs,
  refactor, test, perf, build, ci, style, revert).
- **Required label trio** — every PR must carry one each of `type:*`,
  `size:*`, and `safe:*` (the merge-autonomy classification, §5). The check
  wraps the joined label list in delimiting commas and matches `,prefix:` so
  a label merely *containing* the prefix can't satisfy it.
- **Plain-language TL;DR** — the PR body must contain a `## TL;DR` section
  with real content (heading matched at any level, case-insensitive,
  code-fence-aware; HTML comments stripped so the template's instruction
  comment doesn't count; the template's bare `-` placeholder doesn't count).
  Feeds a Slack "what shipped" feed on merge, so non-engineers can follow the
  repo. **A validator can't judge prose quality — these body gates are
  forcing functions, not proof.**
- **Adversarial-review record** — see §6.
- **Bot exemptions, precisely scoped:** Dependabot PRs are exempt from the
  label-trio, TL;DR, and review-record gates (a bot can't run an authoring
  workflow), and its config pre-applies the labels it *can* know
  (`dependencies`, `skip-changelog`, `safe:human`). Exemptions are per-check
  `if:` conditions on the PR author — not a global bypass.

### 4.3 Changelog gates

Two complementary checks:

- **Fragment present** (`ci.yml`): the PR must add a file under
  `changelog.d/` (diffed against the merge base), unless it's from a
  `release/*` branch or carries the `skip-changelog` label. Per-PR fragment
  files (`<slug>.<category>.md`, Keep-a-Changelog categories) mean PRs never
  conflict on a shared CHANGELOG.
- **Fragments valid** (`changelog:check` script): every fragment parses,
  every bullet carries a required tag.
- **Release check** (`release-check.yml`): any PR that bumps
  `package.json#version` must also add the matching `## [X.Y.Z]` CHANGELOG
  section and a migration guide — silent version bumps fail.

---

## 5. Security + supply-chain gates

### 5.1 Secret scanning — gitleaks

Full-history scan (`fetch-depth: 0`) on every push/PR; any finding fails the
job. Near-zero configuration; start here if you adopt only one security gate.

### 5.2 Dependency vulnerabilities — osv-scanner + a cooldown-aware wrapper

The scanner itself is standard (osv-scanner against the lockfile, JSON
output). The **wrapper logic is the innovation worth porting** if you also
quarantine new releases:

- Context: the repo blocks installing any package version younger than 7 days
  (`minimumReleaseAge: 10080` in pnpm config, mirrored by
  `cooldown: default-days: 7` in Dependabot) — compromised releases are
  usually caught within days of publish.
- Problem: a bare vulnerability scan fails the instant an advisory publishes,
  demanding a fix the package manager is configured to refuse for up to a
  week. A gate that must be hand-bypassed weekly stops being read.
- Resolution, per finding: *is the fixed version old enough to install yet?*
  - Not yet → `::warning::` with the exact date the deferral lapses; build
    stays green. Self-expiring: it turns red on its own, so nothing is
    forgotten.
  - Yes → `::error::`, build fails — the fix is installable, install it.
  - No fixed version exists → fail immediately (nothing to wait for).
  - CVSS ≥ 9.0 (Critical) → fail immediately regardless of quarantine; a
    Critical warrants an explicit human fast-track decision.
- Accepted-risk waivers live in the scanner's native ignore file
  (`osv-scanner.toml`), each entry being a reviewed decision — and that file
  is owner-review-gated (§5.5).
- Fail-closed: missing/unparseable results or unreachable registry fails the
  build, with wording that makes clear it's an infrastructure failure, not an
  advisory.

### 5.3 License allowlist

`pnpm licenses list --json` (or your ecosystem's equivalent) parsed against an
explicit **permissive-only allowlist** (MIT, ISC, Apache-2.0, BSD family,
0BSD, CC0, Unlicense, …). Anything else — copyleft, unknown, unlicensed —
fails with the package + license named. Two extension paths, by design:
add a new *permissive* SPDX id to the allowlist; or add a **package-scoped**
reviewed exception with a written rationale (never license-scoped — accepting
one MPL build tool must not wave through every future MPL dependency).
SPDX expressions are evaluated properly: `OR` passes if either side is
allowed, `AND` requires both.

### 5.4 SAST — CodeQL

Standard CodeQL analysis (javascript-typescript) on PR, push, and a weekly
schedule, isolated in its own workflow so only it holds
`security-events: write`. **Gotcha documented in the workflow itself:** the
analyze step uploads alerts but exits 0 — CodeQL only blocks merges once the
code-scanning check is marked *required* in branch protection. Until an admin
does that, it's advisory. Say this out loud in your setup docs or you'll
believe you have a gate you don't.

### 5.5 Supply-chain posture (package-manager config, not CI)

Enforced at install time, so CI inherits it:

- **7-day release quarantine** including transitive deps (see §5.2), with the
  fast-track exclusion list kept **empty** as the healthy state — every entry
  is a documented hole with a tracked removal.
- **Exotic sources blocked for transitive deps** — subdependencies must
  resolve from the registry, not git/tarball URLs.
- **Install scripts off by default**, with a per-package `allowBuilds`
  allowlist naming why each package needs its postinstall (native binaries,
  git hooks).
- **Security-floor version overrides** for known-vulnerable transitive deps,
  each with a comment explaining what it floors and what breaks if moved.
- Dependabot: weekly, grouped minor+patch PRs (majors separate), 7-day
  cooldown, labels pre-applied to satisfy the convention gates honestly.

### 5.6 Owner-review gate — the two-layer autonomy boundary

The most agent-specific guardrail, and the one an engineering manager will
want most. It answers: *which changes may ship on green CI alone, and which
always need a specific human?*

Seven owner-gated categories here: cost (billed APIs/infra), legal, security
(auth/session/RBAC/secrets), the trust-and-safety domain model, destructive or
irreversible data migrations, data-collection/privacy posture, and
safety-disclaimer copy. Your categories will differ; the architecture won't:

- **Layer 1 — the teeth: CODEOWNERS + branch protection.** A CODEOWNERS file
  maps exactly the gated paths to the owner; branch protection enables
  "Require review from Code Owners" + "Dismiss stale approvals on new
  commits" + "Do not allow bypassing". An owned-path PR *cannot merge* until
  the owner approves — no collaborator, bot, admin, or agent can satisfy it.
  Everything not listed is deliberately unowned, so the majority of PRs need
  zero owner review and ship on green.
- **Layer 2 — the tripwire: a CI job.** A script re-derives the gated surface
  (from a shared module — see drift note below) over the PR's diff and
  **fails the PR if it touches a gated surface without the `safe:human`
  label** — i.e. an agent tried to classify its own gated change as
  auto-mergeable. It also runs *content* checks that paths can't express,
  over added/removed diff lines: destructive SQL patterns
  (`DROP TABLE|COLUMN|CONSTRAINT`, `TRUNCATE`, `DELETE FROM`, column-type
  narrowing…) in migrations, legal/safety-disclaimer phrasing in *any* file
  (the copy may move), and telemetry/PII-posture signals (new tracker
  imports/init, `sendDefaultPII: true`, sampling-rate changes,
  `identify(`/`setUser(` calls). Content checks are best-effort heuristics,
  deliberately broad — a false positive costs a label; a false negative is a
  silent tracker. **There is deliberately no bypass label for this gate.**
- **Anti-drift:** the path list lives in one module consumed by the CI
  script, and a unit test asserts it and CODEOWNERS never diverge —
  bidirectionally.
- **Self-protection:** the `.github/` directory (CODEOWNERS, every workflow,
  every guard script), the agent-instructions file, ADRs, and every
  tool config that holds a threshold (lint config, tsconfig, coverage/vitest
  config, knip/jscpd/stryker configs, commitlint) are themselves owned paths.
  Loosening a gate — or "fixing" a red build by editing the test config —
  requires the owner's review. Close the "loosen the tests instead of the
  guard" hole explicitly.

### 5.7 Merge-autonomy labels (`safe:*`)

Every PR is classified by its author: `safe:agent` (an agent may self-merge
once CI is fully green, resolving conflicts and babysitting checks itself) or
`safe:human` (agents drive CI green, then stop; a human always clicks merge).
The label-trio gate (§4.2) forces the classification to exist; the
owner-review gate (§5.6) forces it to be honest on gated surfaces; branch
protection forces it to be honest even when CI is fooled. Agents are
additionally instructed to never merge — or enable auto-merge on — a
`safe:human` PR.

---

## 6. Process gates: making agent review auditable

The repo requires multi-lens adversarial review of agent-written changes
*before* a PR is mergeable, and encodes it in CI:

- The review panel: 4 always-on lenses (correctness, security, conventions,
  architecture) plus 5 conditionally-routed ones (design, accessibility,
  copy, performance, data), each review performed by a **fresh reviewer
  agent that was not the author**, capped at 2 rounds per lens; unresolved
  items past the cap are escalated in the PR body rather than silently
  dropped.
- The CI gate (`adversarial-review` job) requires **both**: the
  `review:adversarial-passed` label, **and** a well-formed panel record in
  the PR body — a `<lens>: SHIP` line for each always-on lens plus
  `overall: SHIP` inside an `## Adversarial review` section (or the explicit
  escalation marker). The parser is tolerant of formatting variants,
  strips HTML comments so template placeholders don't count, and rejects
  `SHIPPED`/`SHIP-NOT` lookalikes.
- `skip-review` is the sanctioned bypass label for trivial/human-authored
  changes — visible on the PR, greppable, and auditable, unlike a gate
  people quietly route around.
- **Honest limitation, stated in the repo's own docs:** a body can be
  fabricated. The gate is a forcing function and an audit record, not proof.
  The unfoolable layers remain CODEOWNERS + branch protection.

The PR template mirrors every gate (TL;DR section, changelog checklist,
owner-sign-off checklist mapping the gated categories, adversarial-review
section), so authors — human or agent — see the requirements at authoring
time instead of discovering them as red checks.

---

## 7. Post-merge and lifecycle workflows (context, not PR gates)

For completeness — these run outside the PR gate but complete the loop:

- **Production DB migration** on merge to `main` when schema/migrations
  changed; serialized concurrency; skips with a warning when the prod secret
  is absent.
- **Preview-DB migrate + seed** per PR (schema PRs are testable in preview
  with realistic data instead of 500ing against a stale schema), with the
  same required-check relevance pattern and migration-verify guard as §3.10.
- **Preview-DB branch cleanup** when a PR closes (scoped to only that PR's
  preview branch).
- **Post-deploy smoke** curls the *live* production URL after a deploy —
  local build smoke (§3.8) can be green while the real deployment is down.
- **Slack merge updates** posts each merged PR's TL;DR to Slack (this is what
  the TL;DR gate feeds). Uses `pull_request_target` for secrets on fork PRs,
  made safe by never checking out or executing PR-head code and passing
  title/body/author via env only.

---

## 8. Adoption guide for a new repository

Suggested order — each tier is independently valuable and the earlier tiers
are prerequisites for none of the later ones except as noted:

**Tier 1 — table stakes (first day):**
lint+format check, typecheck, unit tests (with `.only` failing), and the
setup conventions from §2 (least privilege, SHA pinning, concurrency,
frozen lockfile, toolchain pinned from files). Add the pre-commit hook and a
single `preflight` command. Make the checks required in branch protection.

**Tier 2 — quality ratchets (first week):**
diff coverage on changed lines (safe on legacy code by construction — §3.6),
dead-code check, duplication check, secret scanning, PR-title lint.
Calibrate the duplication token floor and coverage threshold on your own tree.

**Tier 3 — enforce your rules-as-prose:**
turn the conventions your reviewers repeat into hard-rule matchers (§4.1),
add the changelog-fragment gate if you keep a changelog, add the required
label set and TL;DR gate if you want them, wire the merge-to-Slack feed.

**Tier 4 — the autonomy boundary (before agents self-merge anything):**
decide your owner-gated categories, write CODEOWNERS + the tripwire script +
the drift test (§5.6), define `safe:agent`/`safe:human`, turn on the branch
protection that gives Layer 1 teeth. If agents review agents, add the
review-record gate (§6).

**Tier 5 — depth:**
mutation testing scoped to your highest-stakes logic, the osv cooldown
wrapper + license allowlist + CodeQL (remembering §5.4's required-check
gotcha), build-artifact assertions (§3.8), accessibility lane, absolute
coverage floor, supply-chain install posture (§5.5).

Throughout, keep the two meta-rules that make this whole surface durable:
**every threshold is measured and its rationale written next to it in the
config**, and **every gate's own config is part of the protected surface.**

---

## 9. Quick-reference: check inventory

| Check (job) | Tool | Fails when | Bypass |
| --- | --- | --- | --- |
| Lint & format | Biome | any lint/format finding | none |
| Type check | tsc (strict) | any type error | none |
| Dead code | knip | unused file/export/type/dependency | config entry + rationale |
| Duplication | jscpd (70 tokens, threshold 0) | any non-test clone | inline ignore + reason |
| Hard rules | custom script | env-access / suppression / db-in-client / raw-fetch / dishonest-test | fix it |
| Unit tests | Vitest (`--allowOnly=false`) | failure or committed `.only` | none |
| Diff coverage | Vitest coverage + custom script | changed-line coverage < 80%, or repo floor breached | none |
| Mutation score | Stryker (scoped paths) | score < 94 on trust-critical modules | none |
| Migrations in sync | regenerate + `git status --porcelain` | schema/migration drift | none |
| Build smoke | build + grep + curl | server code in client bundle; page/assets/health broken | none |
| Changelog fragment + valid | diff check + validator | missing/invalid fragment | `skip-changelog` label |
| PR title | commitlint | non-Conventional-Commit title | none |
| PR labels | expression check | missing `type:*`/`size:*`/`safe:*` | Dependabot only |
| TL;DR | custom script | missing/empty `## TL;DR` | Dependabot only |
| Adversarial review | label + body parser | missing label or malformed panel record | `skip-review` label |
| Owner review | custom script + CODEOWNERS | gated surface without `safe:human`; owned path without owner approval | none, by design |
| Secret scan | gitleaks | any leaked secret in history | none |
| Dependency vulns | osv-scanner + cooldown wrapper | installable-fix finding, no-fix finding, or any Critical | reviewed waiver in scanner config |
| License allowlist | custom script over pnpm licenses | non-permissive/unknown license | package-scoped reviewed exception |
| CodeQL | github/codeql-action | only if marked required in branch protection | admin setting |
| Accessibility | Playwright + axe-core | any violation on audited pages | none |
| Integration & E2E | Vitest + Playwright | failures (when DB secret present) | secret absence ⇒ skip |
| Release check | version diff + greps | version bump without CHANGELOG section + migration guide | don't bump |
