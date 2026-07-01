# Finding and Executing Work

This doc covers how agents interact with the GitHub Issues-based task system. Read it before picking up any task.

> **`gh` CLI vs GitHub MCP.** The `gh` commands below are illustrative. Agents running in **Claude Code on the web** don't have the `gh` CLI — they use the **GitHub MCP tools** (`mcp__github__*`) instead, which do the same thing (list/view/edit issues, open PRs). **Local** sessions use the `gh` CLI as shown. Either way the workflow — discover, claim, branch, hand off — is identical.

---

## Discovering Available Work

```bash
# List all tasks ready for an agent to claim
gh issue list --label "status:ready,safe:agent" --assignee "" --state open
```

Add `--label "size:s"` (or `size:xs`, `size:m`) to filter by scope. Avoid `size:l` issues — they require a planning session before execution.

---

## Claiming a Task

Before starting, verify the issue is still unclaimed:

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

This assignment is the distributed lock. Do not start work on an issue already assigned to someone else.

---

## Branch Naming

Create a worktree branch off `main` named:

```
issue-<NUMBER>-<short-slug>
```

Example: `issue-42-add-user-avatar`

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
2. Read `AGENTS.md` and the relevant sub-doc(s) in `docs/agents/` before touching code.
3. Work in the branch created above.
4. Commit early and often. **Commit messages MUST follow [Conventional Commits](https://www.conventionalcommits.org): `type: brief description`** (e.g., `feat: add avatar upload endpoint`). Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `style`, `revert`. This is **enforced** by a local `commit-msg` hook (commitlint, via Lefthook) — a non-conforming message blocks the commit. Config lives in `commitlint.config.mjs`.
5. Run `pnpm check` before every commit.
6. Run `pnpm preflight` before declaring work complete — it runs lint, typecheck, and tests in one command.

---

## Pre-commit Hooks

This project uses [Lefthook](https://github.com/evilmartians/lefthook) to run pre-commit hooks automatically. After running `pnpm install`, Lefthook installs its Git hooks via the `prepare` lifecycle script. No manual setup is required.

When you commit, Lefthook runs `biome check --staged` on all staged files matching common source extensions (`.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.css`). This catches lint and formatting issues before they enter the repository. If the check fails, the commit is blocked until you fix the reported problems.

You can still run `pnpm check` manually for a full project-wide lint and format pass, but the pre-commit hook ensures that every commit is at least locally clean.

---

## Updating the Changelog

Don't hand-edit `CHANGELOG.md`. Instead, every PR adds its own **changelog fragment** under `changelog.d/`. Because each PR ships a separate file, PRs never collide on the changelog, and CI **requires** a fragment on every PR (unless the PR carries the `skip-changelog` label).

Create a file named `<slug>.<category>.md`, where `<category>` is one of the [Keep a Changelog](https://keepachangelog.com) sections: `added`, `changed`, `deprecated`, `removed`, `fixed`, `security`. The `<slug>` is anything unique — conventionally the issue number plus a few words (e.g. `42-unused-deps`).

Each bullet must start with a propagation tag. In this repo (an instance, not the template), default to `[manual]`:

```markdown
- `[manual]` Brief description of what changed and why.
```

Validate with `pnpm changelog:check` (also runs in CI). **`changelog.d/README.md` is the source of truth** for categories, propagation tags, and when each applies — read it before adding a fragment.

---

## Handing Off for Review

When all acceptance criteria are met, open a PR referencing the issue:

```bash
gh pr create --title "<type>: <description>"
```

The PR body is **auto-populated** from `.github/pull_request_template.md` — fill in its sections (`## Summary`, `Resolves #<NUMBER>`, `## Test plan`, and the Propagation checklist) rather than writing a body from scratch. Web sessions opening PRs through the GitHub MCP tools should mirror the same template structure. The `Resolves #<NUMBER>` link is what auto-closes the issue on merge.

**PRs are squash-merged**, which promotes the PR *title* to the final commit
message on `main`. Because of that, the PR title MUST be a valid Conventional
Commit (`<type>: <description>`, same allowed types as commits above). CI's
`pr-title` job runs commitlint against the title and fails the PR if it doesn't
conform.

**Every PR must carry one each of the following labels** (CI's `pr-labels` job
enforces this and names any missing dimension):

- a `type:*` label (`type:bug`, `type:feature`, `type:chore`, `type:docs`)
- a `size:*` label (`size:xs`, `size:s`, `size:m`, `size:l`)
- a `safe:*` label (`safe:agent` or `safe:human`)

These usually carry over from the issue; add any that are missing to the PR.

Then update the issue label:

```bash
gh issue edit <NUMBER> --remove-label "status:in-progress" --add-label "status:needs-review"
```

Do not close the issue yourself. The merged PR closes it automatically via the `Resolves #N` link in the body.

---

## When to Stop and Ask

Stop and leave a comment on the issue if:

- The acceptance criteria are ambiguous or contradictory
- The task requires an action only the human can take — provisioning a
  secret/account, running a deploy, applying a prod migration. (A `safe:human`
  label is **not** itself a stop signal: implement the change and open the PR;
  the human just reviews and merges it — see the label reference below.)
- You discover the actual scope is `size:l` — don't expand silently
- Something unexpected is broken that blocks progress

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
| `safe:agent` | Agent may merge the PR once CI passes |
| `safe:human` | Agent implements it, but a human reviews and merges — never auto-merged |
| `type:bug` | Something broken |
| `type:feature` | New functionality |
| `type:chore` | Maintenance / tooling |
| `type:docs` | Documentation |
| `skip-changelog` | PR intentionally ships without a changelog fragment |
