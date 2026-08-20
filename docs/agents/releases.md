# Releases

**Decision rule:** every bump of `package.json` `version` on the construct
template lands in one PR with three files: the bumped `package.json`, a new
`CHANGELOG.md` section, and a `docs/migrations/vX.Y.md` guide.
`.github/workflows/release-check.yml` fails the PR if any is missing.

Releases exist only on the construct template. Instances track their template
version in `.construct` and release independently.

## The Three-File Rule

1. **`package.json`** — bumped `version` field. Ground truth for "which version
   am I on" (captured in `.construct` at scaffold time).
2. **`CHANGELOG.md`** — new section for the target version, a propagation tag on
   every entry (`[propagate]`, `[template-only]`, `[manual]`). The flat index of
   *what* changed.
3. **`docs/migrations/vX.Y.md`** — ordered playbook for *how* an instance moves
   across this version. Cover every `[propagate]` entry.

## Changelog Entries Are Fragments

Do not edit `CHANGELOG.md` day to day. Each PR adds a fragment file under
`changelog.d/` named `<slug>.<category>.md` (category = `added` / `changed` /
`fixed` / …), each bullet carrying a propagation tag. CI requires a fragment on
every PR (skippable with the `skip-changelog` label). `pnpm changelog:check`
validates format; `pnpm changelog:preview` renders the pending section. Format
reference: `changelog.d/README.md`. The release step folds fragments into a real
`## [X.Y.Z]` section.

## Version Bump Workflow

1. Pick the version per semver:
   - **Patch** — bug fixes, doc corrections, non-behavioral changes.
   - **Minor** — new features, additive conventions, new sub-docs, non-breaking
     dependency bumps.
   - **Major** — anything forcing instances to change code, rename files, or
     migrate data non-trivially.
2. Bump `version` in `package.json`.
3. Run `pnpm changelog:release <version>` to fold `changelog.d/` fragments into a
   `## [<version>] - <date>` section (grouped `Added` / `Changed` / `Fixed`, tags
   preserved) and delete the consumed fragments. `pnpm changelog:preview` shows
   what will land.
4. Create `docs/migrations/vX.Y.md` from `docs/migrations/template.md`. Cover
   every `[propagate]` CHANGELOG entry.
5. Tick the PR template's "Propagation" checkbox only when all three files are
   present.

## Propagation Tags on CHANGELOG Entries

Every bullet in a release section starts with one of:

| Tag | Meaning | Example |
| --- | ------- | ------- |
| `[propagate]` | Apply to existing instances during propagation | New hard rule, updated API doc, new dev dependency |
| `[template-only]` | Affects only the construct template | New ADR, change to `validate-template.yml`, scaffold logic |
| `[manual]` | Needs human judgment before applying to instances | Breaking config change with no clean automatic migration |

If unsure, default to `[manual]` and note what the reviewer must check.

## No Silent Version Bumps

Never bump `version` for hygiene. A bump promises a documented migration path
and a complete CHANGELOG section. No real changes — no bump.
