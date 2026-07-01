# Planning & Epics in Linear

> **Decision rule:** Structured, tracked work lives in **Linear** (initiatives,
> epics, work items). **GitHub stays the code layer** (branches, PRs, CI, merge).
> Plan and claim in Linear; ship in GitHub; the two are linked by magic words.
> See ADR-012 for why.

Linear MCP tools are `mcp__Linear__*`. If not loaded, pull schemas with
`ToolSearch` (`select:mcp__Linear__list_issues,mcp__Linear__save_issue,...`).

---

## Where `aubreyslist` lives

`aubreyslist` has its **own Linear team** — key **`AUB`**, so issues are
`AUB-123`. The free tier caps teams at **2**; a slot was freed (the old
`construct` team) to give `aubreyslist` a dedicated team alongside `brbcoding`.
The payoff is a clean namespace: its own **250-issue budget**, cycles, states,
and labels, not shared with `brbcoding`. That 250-issue cap is a hard block at
the limit, so archive/close aggressively.

| Concept        | Linear object      | Notes                                        |
| -------------- | ------------------ | -------------------------------------------- |
| Big theme      | Initiative         | Optional; group related Projects             |
| Epic           | **Project**        | e.g. "Deploy & launch" — was a `type:epic`   |
| Work item      | **Issue** (`AUB-*`) | The claimable unit                          |
| Sub-task       | Sub-issue (`parentId`) | Break a work item down                   |
| Time-box       | Cycle              | Optional for a solo project                  |

---

## State & label mapping (from the GitHub taxonomy)

The `AUB` team has these **workflow states**: `Backlog`, `Todo`, `In Progress`,
`In Review`, `Done`, `Canceled`, `Duplicate` (no `Triage`). Map the old
`status:*` labels onto states — states are native to Linear, so stop encoding
status as labels:

| GitHub label            | Linear equivalent                               |
| ----------------------- | ----------------------------------------------- |
| `status:ready`          | State **Todo**, unassigned                       |
| `status:in-progress`    | State **In Progress**, assigned                  |
| `status:needs-review`   | State **In Review**                              |
| `status:blocked`        | Keep state; add a **blockedBy** relation         |
| (merged / done)         | State **Done** (auto via PR merge, below)        |

Existing labels are `Improvement`, `Bug`, `Feature`. To preserve the rest of the
taxonomy, **create these labels once** (setup step, not per-task):

- Type completeness: `Chore`, `Docs` (alongside `Bug` / `Feature` / `Improvement`).
- Agent safety: **`safe:agent`** and **`safe:human`** — the claim gate below.
- Size: use Linear **estimates** (XS/S/M/L → 1/2/3/5) instead of `size:*` labels.

---

## Agent workflow: claim → branch → PR → auto-close

1. **Discover claimable work.** Issues in state **Todo**, unassigned, labeled
   **`safe:agent`**:

   ```
   mcp__Linear__list_issues  team:aubreyslist  state:Todo  assignee:null  label:safe:agent
   ```

   Skip `safe:human` items (auth, schema, deploys, external services) — those
   need human approval first, same rule as `docs/agents/tasks.md`.

2. **Claim it** (the assignment is the lock): `save_issue` with `id`,
   `assignee:"me"`, `state:"In Progress"`. Don't pick up an already-assigned
   issue.

3. **Branch off `main`.** `get_issue` returns Linear's **git branch name** — use
   it so the GitHub integration auto-links the PR. Otherwise keep the repo
   convention (`issue-<n>-<slug>` still fine for GitHub-native items).

4. **Open the PR the normal way** (`docs/agents/tasks.md`): Conventional-Commit
   title, required `type:*` / `size:*` / `safe:*` PR labels, a `changelog.d/`
   fragment. Put Linear's magic word in the PR (e.g. **`Fixes AUB-123`**) so
   merge transitions the issue to **Done** automatically.

5. **Hand off:** move the issue to **In Review**. The merged PR closes it —
   don't set Done by hand.

> **GitHub, not Linear, still gates merge.** CI (`pr-title`, `pr-labels`,
> changelog) is unchanged. Linear tracks *what* and *why*; GitHub enforces *how
> it ships*.

---

## Boundaries (don't blur the three systems)

| System        | Owns                                    | Don't use it for                  |
| ------------- | --------------------------------------- | --------------------------------- |
| **Linear**    | Planning, epics, tracked work items     | Code review; ephemeral UI notes   |
| **GitHub**    | Branches, PRs, review, CI, merge        | Epic/roadmap structure            |
| **Vercel**    | Viewport-anchored preview feedback      | Tracking long-lived work          |

- **Don't auto-file a Linear issue per Vercel toolbar comment**
  (`docs/agents/preview-feedback.md`) — the 250-issue cap is real. Promote a
  comment to an Issue only when it's scope that outlives the session.
- **Don't double-track.** One work item = one Linear Issue linked to one PR.
  Avoid a mirror GitHub issue for the same work.

---

## Rollout status

Staged migration (ADR-012), not a big bang:

- [x] Create the `aubreyslist` team (`AUB`).
- [ ] Create labels: `Chore`, `Docs`, `safe:agent`, `safe:human`.
- [ ] Port seed GitHub epics `#8`, `#9` (and children) into Projects/Issues.
- [ ] Confirm Linear ↔ GitHub integration links PRs and transitions state.

Until ported, the GitHub Issues list (`docs/agents/issues.md`) stays
authoritative for in-flight work; **new** epics start in Linear.
