# Propagation

This doc is for agents tasked with propagating construct template changes to existing project instances.

---

## What Propagation Means

When construct is updated, some changes should be rolled out to projects that were previously scaffolded from it. This doc explains how to do that reliably.

---

## Setup

You will be pointed at a directory containing one or more construct instances. Each instance has a `.construct` file at its root:

```json
{
  "constructVersion": "0.1.0",
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
2. **Read construct's `CHANGELOG.md`** — identify all entries newer than that version
3. **Filter by tag** — only act on entries tagged `[propagate]`. Skip `[template-only]` and flag `[manual]` for human review
4. **Apply changes** — make the equivalent change in the instance, respecting the instance's existing code
5. **Update `.construct`** — bump `constructVersion` to the current construct version
6. **Run `pnpm check` and `pnpm typecheck`** — verify the instance is still healthy after changes

---

## Rules

- **Never overwrite instance-specific files** — `README.md`, `CHANGELOG.md`, `db/schema.ts`, and anything in `app/routes/` beyond the base files are instance-owned
- **`AGENTS.md` and `docs/agents/` are propagatable** — these are conventions, not project-specific content. Update them if the construct versions differ meaningfully
- **Config files are propagatable with care** — `biome.json`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts` can be updated if the change is additive. Do not remove existing customizations the instance may have made
- **If a change conflicts with instance code**, flag it for human review rather than guessing
- **One instance at a time** — complete and verify each instance before moving to the next

---

## After Propagation

Leave a summary of what was applied, what was skipped, and what needs manual review. Format it as a short markdown file dropped into the instance root as `PROPAGATION_NOTES.md` — the human can delete it once reviewed.
