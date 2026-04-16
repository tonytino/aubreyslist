# Propagation

This doc is for agents tasked with propagating construct template changes to existing project instances.

---

## What Propagation Means

When construct is updated, some changes should be rolled out to projects that were previously scaffolded from it. This doc explains how to do that reliably.

---

## How Scaffolded Projects Track Their Template Version

Every project scaffolded from construct has a `.construct` JSON file at the repository root. This is the **single source of truth** for which template version the project was created from. The scaffold script (`scripts/scaffold.mjs`) writes this file automatically during setup.

The key field is **`constructVersion`** — it records the construct `package.json` version at the time of scaffolding. During propagation, you update this field to the current construct version after applying changes.

Always check `.construct` first when working with a scaffolded project. If the file is missing or the `constructVersion` field is absent, the project predates version tracking and should be treated as version `0.0.0`.

---

## Setup

You will be pointed at a directory containing one or more construct instances. Each instance has a `.construct` file at its root:

```json
{
  "constructVersion": "0.2.0",
  "projectName": "my-project",
  "projectSlug": "my-project",
  "scaffoldedAt": "2026-04-13T00:00:00.000Z"
}
```

You will also have access to the current construct repo and its `CHANGELOG.md`.

---

## Propagation Workflow

For each instance in the target directory:

1. **Read `.construct`** — note the `constructVersion` the instance was scaffolded from
2. **Consult the migration guide** — look in `docs/migrations/` for the guide covering the version range you are propagating across. For example, if the instance is on 0.1.0 and construct is on 0.2.0, read `docs/migrations/v0.2.md`. If multiple version jumps are needed, apply each migration guide in sequence
3. **Read construct's `CHANGELOG.md`** — identify all entries newer than that version
4. **Filter by tag** — only act on entries tagged `[propagate]`. Skip `[template-only]` and flag `[manual]` for human review
5. **Apply changes** — follow the migration guide steps in order, respecting the instance's existing code
6. **Update `.construct`** — bump `constructVersion` to the current construct version
7. **Run `pnpm check` and `pnpm typecheck`** — verify the instance is still healthy after changes

---

## Rules

- **Never overwrite instance-specific files** — `README.md`, `CHANGELOG.md`, `db/schema.ts`, and anything in `app/routes/` beyond the base files are instance-owned
- **`AGENTS.md` and `docs/agents/` are propagatable** — these are conventions, not project-specific content. Update them if the construct versions differ meaningfully
- **Config files are propagatable with care** — `biome.json`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts` can be updated if the change is additive. Do not remove existing customizations the instance may have made
- **If a change conflicts with instance code**, flag it for human review rather than guessing
- **One instance at a time** — complete and verify each instance before moving to the next

---

## Migration Guides

Every version bump to construct must include a corresponding migration guide in `docs/migrations/`. The guide is named after the target version (e.g., `v0.2.md` for the 0.1.0 to 0.2.0 migration). Use `docs/migrations/template.md` as the starting point.

A migration guide must contain:

- **Breaking Changes** -- anything that will break existing instances if not addressed
- **Migration Steps** -- an ordered checklist an agent can follow mechanically
- **Files Affected** -- every file that changed, with a one-line description

When bumping the version in `package.json`, create the migration guide in the same PR.

---

## After Propagation

Leave a summary of what was applied, what was skipped, and what needs manual review. Format it as a short markdown file dropped into the instance root as `PROPAGATION_NOTES.md` — the human can delete it once reviewed.
