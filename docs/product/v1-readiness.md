# v1 Readiness Checklist

> **Decision rule:** Don't cut `v1.0.0` until every box below is checked. This
> checklist gates the v1 release; it is the companion to issue #71 ("Adopt
> versioned releases / cut v1.0.0"). Work the release through that issue.

The product scope for v1 is defined in `docs/product/overview.md` (see the
**v1 Scope** and **Explicitly deferred** sections). This doc is purely about the
mechanics of cutting the release once that scope is shipped.

---

## Release mechanics

- [ ] **Issue #71 is the tracking issue.** All v1-cut work hangs off it.
- [ ] **Fold the changelog fragments into a release section.** Run
      `pnpm changelog:release <version>` (e.g. `pnpm changelog:release 1.0.0`).
      This assembles every pending fragment in `changelog.d/` into a dated
      `CHANGELOG.md` section and deletes the fragments. Do this on a
      `release/*` branch (CI exempts `release/*` from the per-PR fragment
      requirement — see `changelog.d/README.md`).
- [ ] **Add a migration note if warranted.** If any folded fragment carries a
      `` `[propagate]` `` tag whose change requires action by a spawned instance,
      add `docs/migrations/v1.0.md` describing the upgrade step. If nothing
      `[propagate]`-tagged needs instance action, skip the file. (See
      `changelog.d/README.md` for what `[propagate]` means in this instance.)
- [ ] **Deploy is on Vercel per ADR-009.** Confirm the v1 deploy targets Vercel
      via the Nitro/Vercel preset (`docs/decisions/009-vercel-hosting-v1.md`).
      The Vercel project and its secrets are human-provisioned (`safe:human`).
- [ ] **Tag and publish `v1.0.0`** once the release branch merges.

---

## Branch protection / required status checks

> **`safe:human` — repo settings.** The items below are configured by the
> maintainer in **GitHub repo settings → Branches → branch protection for
> `main`**, not by an agent in code. They are recommendations to apply before
> (or as part of) the v1 cut.

Recommended for the `main` branch:

- [ ] **Require pull requests before merging** (no direct pushes to `main`).
- [ ] **Require status checks to pass before merging**, and mark the following
      checks **required**.

> **These check names are live and confirmed.** The split `ci.yml` jobs and the
> `pr-conventions.yml` workflow are merged and have run on a real PR. GitHub keys
> required status checks on the **job name** (shown in the Actions tab / PR checks
> list), and only offers a check in the required-checks picker once it has run at
> least once — all of the names below have, so they're selectable. Do **not**
> require the third-party `Vercel Preview Comments` check (not a quality gate).

| Required check (job name)    | Workflow              |
| ---------------------------- | --------------------- |
| `Lint & format`              | `ci.yml`              |
| `Type check`                 | `ci.yml`              |
| `Unused deps`                | `ci.yml`              |
| `Changelog fragments valid`  | `ci.yml`              |
| `Unit tests`                 | `ci.yml`              |
| `Integration & E2E`          | `ci.yml`              |
| `Production build smoke`     | `ci.yml`              |
| `Changelog fragment present` | `ci.yml`              |
| `Conventional PR title`      | `pr-conventions.yml`  |
| `Required PR labels`         | `pr-conventions.yml`  |

- [ ] **Require branches to be up to date before merging** (re-run checks on the
      merge result).
- [ ] **Do not allow auto-merge for `safe:human` PRs.** Per
      `docs/product/overview.md`, nothing auto-merges; sensitive PRs are
      human-reviewed.
