# Releases

This doc is the convention for bumping the construct template version. When you change `package.json` `version`, this is what you owe.

Releases only exist on the construct template itself. Instances spawned from construct track their template version in `.construct` but have their own independent release process.

## The Three-File Rule

Every version bump to construct **must** land with three things in the same PR:

1. **`package.json`** — bumped `version` field
2. **`CHANGELOG.md`** — new section for the target version with propagation tags on every entry (`[propagate]`, `[template-only]`, `[manual]`)
3. **`docs/migrations/vX.Y.md`** — migration guide for instances propagating across this version

If any of these is missing, the PR is incomplete. The `.github/workflows/release-check.yml` workflow enforces this mechanically — it fails the PR if `version` changed without a matching CHANGELOG section and migration guide.

## Changelog Entries Are Fragments

Day to day you do **not** edit `CHANGELOG.md`'s `[Unreleased]` block. Each PR
instead adds a fragment file under `changelog.d/` named `<slug>.<category>.md`
(category = `added` / `changed` / `fixed` / …) with bullets that each carry a
propagation tag. Because every PR adds its own file, PRs never collide on the
changelog. CI requires every PR to add a fragment (skippable with the
`skip-changelog` label) and `pnpm changelog:check` validates their format;
`pnpm changelog:preview` renders the pending section. See
`changelog.d/README.md` for the format. The release step (below) folds the
fragments into a real `## [X.Y.Z]` section.

## Why All Three

- `package.json` is what scaffolded projects capture in `.construct` when they are created. It is the ground truth for "which version am I on."
- `CHANGELOG.md` is the flat, tagged index. It tells agents "here is what changed and whether each change propagates."
- `docs/migrations/vX.Y.md` is the ordered playbook. It tells agents "here is the exact sequence of edits to apply to an instance to move from the previous version to this one."

None of the three is redundant. The changelog answers *what*. The migration guide answers *how*. The version string answers *when*.

## Version Bump Workflow

1. Decide the new version per semver:
   - **Patch** — bug fixes, doc corrections, non-behavioral changes.
   - **Minor** — new features, additive conventions, new sub-docs, dependency bumps that do not break the build.
   - **Major** — anything that forces instances to change code, rename files, or migrate data in a non-trivial way.

2. Bump `version` in `package.json`.

3. Run `pnpm changelog:release <version>` to fold the accumulated `changelog.d/` fragments into a new `## [<version>] - <date>` section in `CHANGELOG.md` (grouped `Added` / `Changed` / `Fixed`, propagation tags preserved) and delete the consumed fragments. Run `pnpm changelog:preview` first to see exactly what will land.

4. Create `docs/migrations/vX.Y.md` using `docs/migrations/template.md` as a starting point. Cover every `[propagate]` CHANGELOG entry.

5. The PR template's "Propagation" checkbox reminds you to do all three — tick it only when all three files are present.

## Propagation Tags on CHANGELOG Entries

Every bullet in a CHANGELOG release section must start with one of:

| Tag | Meaning | Example |
| --- | ------- | ------- |
| `[propagate]` | Change should be applied to existing instances during propagation | New hard rule, updated API doc, new dev dependency |
| `[template-only]` | Change only affects the construct template itself | New ADR, change to `validate-template.yml`, update to scaffold logic |
| `[manual]` | Requires human judgment before applying to instances | Breaking config change with no clean automatic migration |

If you cannot decide, default to `[manual]` and leave a note explaining what the reviewer needs to check.

## No Silent Version Bumps

Never bump `version` "just to keep it current." A version bump is a promise that:

- Instances on the previous version have a migration path documented.
- Everything since the last version is captured in the CHANGELOG.

If you are tempted to bump for hygiene, don't. Either there are real changes (in which case the three files above are required) or there are not (in which case the version stays put).
