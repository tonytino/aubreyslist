# changelog.d/ — changelog fragments

Pending changelog entries live here as individual files instead of a
hand-edited `## [Unreleased]` block in `CHANGELOG.md`. Because each PR adds its
own file, PRs never collide on the changelog.

CI **requires every PR to add a fragment here.** Exceptions: PRs from a
`release/*` branch (a release assembles the fragments — see
`docs/agents/releases.md`) and any PR carrying the `skip-changelog` label (typo
fixes, CI tweaks).

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

### Which propagation tag in this repo

This project was **scaffolded from the construct template**. Propagation tags
exist so template changes can flow *down* to spawned instances — but this repo
is an **instance (a leaf)**, so the tags do not drive any automatic propagation
here. They are still required for format consistency (`changelog:check` enforces
one per bullet). Convention for this repo:

- **`[manual]`** — default for app-specific work (most changes). Use this unless
  the change is genuinely reusable upstream.
- **`[propagate]`** — use *only* to flag a change worth upstreaming to the
  construct template because every instance would want it (e.g. a generic doc
  rule, a tooling/CI fix). It does nothing automatically here, so when you use
  it you **must also open a tracking issue on
  [`tonytino/construct`](https://github.com/tonytino/construct)** describing the
  change, so it actually gets ported back to the template (and thus to every
  other instance) instead of getting lost. Bots: opening that construct issue is
  part of the task whenever you tag a fragment `[propagate]`.
- **`[template-only]`** — not applicable in an instance; don't use it here.

When unsure, use `[manual]`.

## Commands

```bash
pnpm changelog:preview          # render the pending [Unreleased] section
pnpm changelog:check            # validate every fragment (runs in CI)
pnpm changelog:release <ver>    # fold fragments into a CHANGELOG section, delete them
```

Only `README.md` is exempt from validation; everything else here must be a
valid fragment.
