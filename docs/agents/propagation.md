# Propagation

How to roll construct template changes out to projects previously scaffolded
from it.

## Version tracking

Every scaffolded project has a `.construct` JSON file at the repo root — the
single source of truth for its template version (written by
`scripts/scaffold.mjs`):

```json
{
  "constructVersion": "0.2.0",
  "projectName": "my-project",
  "projectSlug": "my-project",
  "scaffoldedAt": "2026-04-13T00:00:00.000Z"
}
```

Check `.construct` first. If the file or the `constructVersion` field is
missing, treat the project as version `0.0.0`. After applying changes, bump
`constructVersion` to the current construct version.

## Source of truth during propagation

| Document | Role | When it wins |
| -------- | ---- | ------------ |
| Migration guide (`docs/migrations/vX.Y.md`) | **Authoritative** step-by-step playbook | Always. It is the thing you execute — it encodes ordering and interdependencies. |
| CHANGELOG (`CHANGELOG.md`) | **Discovery index** — which entries carry which propagation tag | Only to cross-check that no `[propagate]` item was forgotten in the guide |

**Rule:** follow the migration guide. If a `[propagate]` CHANGELOG entry has no
corresponding migration step, stop and flag it rather than guessing.

## Propagation workflow

For each instance in the target directory:

1. **Read `.construct`** — note its `constructVersion`.
2. **Open the migration guide(s)** — one per version bump between the instance
   and construct, applied in order (0.1.0 → 0.2.0 means `v0.2.md`).
3. **Cross-check `CHANGELOG.md`** — every `[propagate]` entry newer than the
   instance's version must have a step in the guide. If not, stop and flag for
   human review.
4. **Skip `[template-only]`** entries. Flag `[manual]` entries for human review.
5. **Apply the migration guide** in order, respecting the instance's existing
   code.
6. **Update `.construct`** — bump `constructVersion`.
7. **Run `pnpm preflight` and `pnpm build`** — verify the instance is healthy.

## What propagates vs what stays template-only

| Category | Examples | Propagates? |
| -------- | -------- | ----------- |
| Conventions | `AGENTS.md`, `docs/agents/*` | Yes — merge with instance customizations |
| Tooling config | `biome.json`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `lefthook.yml`, `tsr.config.json`, `.gitignore` | Yes — additive only, preserve instance customizations |
| Scripts and deps | `package.json` scripts, dev deps, `pnpm.overrides`, `packageManager` | Yes |
| Example code | `app/utils/format.ts`, `app/components/Greeting.tsx`, `app/routes/__root.tsx`, `app/routes/index.tsx`, and co-located tests (`app/utils/format.test.ts`, `app/components/Greeting.test.tsx`, `app/env.test.ts`) | Yes — skip if instance has customized the file |
| CI workflows | `.github/workflows/ci.yml`, `.github/workflows/release-check.yml`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/*` | Yes |
| Instance-owned | `README.md`, `CHANGELOG.md`, `db/schema.ts`, most of `app/routes/`, `.env*`, `.construct` | **No** — never overwrite |
| Template-only | `TEMPLATE.md`, `docs/decisions/`, `docs/migrations/`, `scripts/scaffold.mjs`, `scripts/labels.mjs`, `.github/workflows/validate-template.yml` | **No** — these describe or validate construct itself |

## Rules

- **Never overwrite instance-specific files** ("Instance-owned" row above).
- **Never copy template-only files** ("Template-only" row above).
- **Config files propagate with care** — additive changes only; keep existing
  customizations.
- **If a change conflicts with instance code**, flag it for human review rather
  than guessing.
- **One instance at a time** — complete and verify each before the next.

## Migration guides

Every construct version bump ships a guide in `docs/migrations/`, named after
the target version (e.g. `v0.2.md`), based on `docs/migrations/template.md`.
Required sections:

- **Breaking Changes** — anything that breaks existing instances if unaddressed
- **Migration Steps** — an ordered checklist an agent can follow mechanically
- **Files Affected** — every changed file, one-line description each

The bump convention (CHANGELOG entry + migration guide + PR template checkbox)
is in `docs/agents/releases.md`, enforced by
`.github/workflows/release-check.yml`.

## After propagation

Drop a short `PROPAGATION_NOTES.md` in the instance root summarizing what was
applied, skipped, and what needs manual review. The human deletes it once
reviewed.
