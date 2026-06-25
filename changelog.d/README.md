# changelog.d/ — changelog fragments

Pending changelog entries live here as individual files instead of a
hand-edited `## [Unreleased]` block in `CHANGELOG.md`. Because each PR adds its
own file, PRs never collide on the changelog.

CI **requires every PR to add a fragment here.** If a change genuinely needs no
changelog entry (a typo fix, a CI tweak, the release PR itself), apply the
`skip-changelog` label to the PR.

## Adding an entry

Create a file named `<slug>.<category>.md`:

- **`<slug>`** — anything unique, conventionally the issue number + a few words
  (e.g. `42-unused-deps`).
- **`<category>`** — one of: `added`, `changed`, `deprecated`, `removed`,
  `fixed`, `security` (the [Keep a Changelog](https://keepachangelog.com)
  sections).

Each non-empty line is a Markdown bullet that **must** start with a propagation
tag (`` `[propagate]` ``, `` `[template-only]` ``, or `` `[manual]` `` — see
`docs/agents/releases.md`). Example `changelog.d/42-unused-deps.changed.md`:

```md
- `[propagate]` Added a `knip` CI check that fails on unused dependencies.
```

## Commands

```bash
pnpm changelog:preview          # render the pending [Unreleased] section
pnpm changelog:check            # validate every fragment (runs in CI)
pnpm changelog:release <ver>    # fold fragments into a CHANGELOG section, delete them
```

Only `README.md` is exempt from validation; everything else here must be a
valid fragment.
