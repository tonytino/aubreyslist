# Finding and Executing Work

This doc covers how agents interact with the GitHub Issues-based task system. Read it before picking up any task.

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
4. Commit early and often. Commit message format: `type: brief description` (e.g., `feat: add avatar upload endpoint`).
5. Run `pnpm check` before every commit.
6. Run `pnpm preflight` before declaring work complete — it runs lint, typecheck, and tests in one command.

---

## Updating the Changelog

Before opening a PR, add an entry to `CHANGELOG.md` under `## [Unreleased]` (create the section if it doesn't exist):

```markdown
## [Unreleased]

### Added / Changed / Fixed
- `[propagate]` Brief description of what changed and why
```

Use the appropriate propagation tag:
- `[propagate]` — change is useful to all existing instances
- `[template-only]` — affects scaffold or template infrastructure only
- `[manual]` — requires human judgment before applying to instances

See `CHANGELOG.md` for the format and existing entries as reference.

---

## Handing Off for Review

When all acceptance criteria are met:

```bash
# Open a PR referencing the issue
gh pr create \
  --title "<type>: <description>" \
  --body "Closes #<NUMBER>

## Summary
- ...

## Test plan
- [ ] ..."
```

Then update the issue label:

```bash
gh issue edit <NUMBER> --remove-label "status:in-progress" --add-label "status:needs-review"
```

Do not close the issue yourself. The merged PR closes it automatically via `Closes #N`.

---

## When to Stop and Ask

Stop and leave a comment on the issue if:

- The acceptance criteria are ambiguous or contradictory
- The task touches `safe:human` concerns (auth, schema changes, deploys, external services)
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
| `safe:agent` | Agent can proceed without pre-approval |
| `safe:human` | Human must approve before agent acts |
| `type:bug` | Something broken |
| `type:feature` | New functionality |
| `type:chore` | Maintenance / tooling |
| `type:docs` | Documentation |
