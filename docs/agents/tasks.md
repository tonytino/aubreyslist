# Finding and Executing Work

How agents interact with the GitHub Issues-based task system. Read before
picking up any task.

> **`gh` CLI vs GitHub MCP.** The `gh` commands below are illustrative. Web
> sessions have no `gh` CLI — use the GitHub MCP tools (`mcp__github__*`), which
> do the same thing. The workflow — discover, claim, branch, hand off — is
> identical.

---

## Discovering Available Work

```bash
# List all tasks ready for an agent to claim
gh issue list --label "status:ready,safe:agent" --assignee "" --state open
```

Add `--label "size:s"` (or `size:xs`, `size:m`) to filter by scope. Avoid
`size:l` issues — they require a planning session first.

---

## Claiming a Task

Verify the issue is still unclaimed:

```bash
gh issue view <NUMBER> --json assignees,labels,title
```

If `assignees` is empty and `status:ready` is present, claim it:

```bash
# Assign yourself
gh issue edit <NUMBER> --add-assignee "@me"

# Update status label
gh issue edit <NUMBER> --remove-label "status:ready" --add-label "status:in-progress"
```

The assignment is the distributed lock. Never start work on an issue already
assigned to someone else.

---

## Branch Naming

Create a branch off `main` named `issue-<NUMBER>-<short-slug>`, e.g.
`issue-42-add-user-avatar`:

```bash
git checkout -b issue-<NUMBER>-<short-slug>
```

Or with a worktree:

```bash
git worktree add -b issue-<NUMBER>-<short-slug> .claude/worktrees/issue-<NUMBER>-<short-slug>
```

---

## Executing the Task

1. Read the issue fully — goal, acceptance criteria, context files.
2. Read `AGENTS.md` and the relevant sub-doc(s) in `docs/agents/` before
   touching code.
3. Work in the branch created above.
4. Commit early and often. **Commit messages MUST follow
   [Conventional Commits](https://www.conventionalcommits.org):
   `type: brief description`** (e.g. `feat: add avatar upload endpoint`).
   Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`,
   `build`, `ci`, `style`, `revert`. Enforced by a local `commit-msg` hook
   (commitlint, via Lefthook); config in `commitlint.config.mjs`.
5. Run `pnpm check` before every commit.
6. Run `pnpm preflight` before declaring work complete — lint, typecheck, and
   tests in one command.

---

## Pre-commit Hooks

[Lefthook](https://github.com/evilmartians/lefthook) installs its Git hooks via
the `prepare` script on `pnpm install` — no manual setup. On commit it runs
`biome check --staged` on staged files (`.ts`, `.tsx`, `.js`, `.jsx`, `.json`,
`.css`); a failing check blocks the commit. `pnpm check` remains the manual
whole-repo lint/format pass.

---

## Updating the Changelog

Don't hand-edit `CHANGELOG.md`. Every PR adds its own fragment under
`changelog.d/`; CI **requires** one (unless the PR carries the `skip-changelog`
label).

Name the file `<slug>.<category>.md`, where `<category>` is a
[Keep a Changelog](https://keepachangelog.com) section: `added`, `changed`,
`deprecated`, `removed`, `fixed`, `security`. `<slug>` is anything unique —
conventionally the issue number plus a few words (e.g. `42-unused-deps`).

Each bullet starts with a propagation tag; in this repo (an instance, not the
template), default to `[manual]`:

```markdown
- `[manual]` Brief description of what changed and why.
```

Validate with `pnpm changelog:check` (also runs in CI).
**`changelog.d/README.md` is the source of truth** for categories and tags —
read it before adding a fragment.

---

## Handing Off for Review

When all acceptance criteria are met, open a PR referencing the issue:

```bash
gh pr create --title "<type>: <description>"
```

The PR body is auto-populated from `.github/pull_request_template.md` — fill in
its sections (`## Summary`, `Resolves #<NUMBER>`, `## Test plan`, the
Propagation checklist) rather than writing a body from scratch. Web sessions
opening PRs through the GitHub MCP mirror the same structure. The
`Resolves #<NUMBER>` link auto-closes the issue on merge.

**PRs are squash-merged**, which promotes the PR *title* to the final commit
message on `main` — so the title MUST be a valid Conventional Commit (same
allowed types as commits). CI's `pr-title` job runs commitlint against it.

**Every PR must carry one each of the following labels** (CI's `pr-labels` job
enforces this and names any missing dimension):

- a `type:*` label (`type:bug`, `type:feature`, `type:chore`, `type:docs`)
- a `size:*` label (`size:xs`, `size:s`, `size:m`, `size:l`)
- a `safe:*` label (`safe:agent` or `safe:human`)

These usually carry over from the issue; add any that are missing.

**Dependabot PRs are exempt** from the `pr-labels` gate (and from `pr-tldr` and
the adversarial-review gate): a bot can't run the labeling/review workflow.
`.github/dependabot.yml` applies the labels it can know up front
(`dependencies`, `skip-changelog`, `safe:human`); the `pr-title` and
`owner-review` gates still run on its PRs.

Then update the issue label:

```bash
gh issue edit <NUMBER> --remove-label "status:in-progress" --add-label "status:needs-review"
```

Do not close the issue yourself. The merged PR closes it via `Resolves #N`.

---

## When to Stop and Ask

Stop and leave a comment on the issue if:

- The acceptance criteria are ambiguous or contradictory
- The task requires an action only the human can take — provisioning a
  secret/account, running a deploy, applying a prod migration. (A `safe:human`
  label is **not** itself a stop signal: implement the change and open the PR;
  the human reviews and merges — see the label reference below.)
- You discover the actual scope is `size:l` — don't expand silently
- Something unexpected is broken that blocks progress

In Claude Code sessions, prefer the AskUserQuestion tool for questions that need
the human — see `docs/agents/orchestration.md` → "Talking to the human".

```bash
gh issue comment <NUMBER> --body "Blocked: <what you found and why you stopped>"
gh issue edit <NUMBER> --remove-label "status:in-progress" --add-label "status:blocked"
```

---

## Label Reference

| Label | Meaning |
|-------|---------|
| `status:ready` | Claimable — no assignee, scoped, ready to go |
| `status:in-progress` | Assigned — do not pick up |
| `status:blocked` | Waiting on something external |
| `status:needs-review` | Agent done, human reviews before close |
| `size:xs` | < 30 min, single file |
| `size:s` | < 2 hrs, isolated change |
| `size:m` | 2–4 hrs, multi-file |
| `size:l` | Needs planning session first |
| `safe:agent` | Agent may merge the PR once CI passes — self-merge runbook in `docs/agents/orchestration.md` |
| `safe:human` | Agent implements it, but a **human** reviews and merges — never auto-merged. **Required** for any change touching an owner-gated surface (cost / legal / security / trust & safety / destructive data / privacy / safety-disclaimer): the `owner-review` CI job fails a gated PR labeled `safe:agent`, and `.github/CODEOWNERS` auto-requests the owner's review. Agents never click merge on these. See `docs/agents/governance.md`. |
| `type:bug` | Something broken |
| `type:feature` | New functionality |
| `type:chore` | Maintenance / tooling |
| `type:docs` | Documentation |
| `skip-changelog` | PR intentionally ships without a changelog fragment |
