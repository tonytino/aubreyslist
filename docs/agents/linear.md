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
- Merge gate: **`safe:agent`** (agent may merge once green) vs **`safe:human`**
  (a human must approve and merge — agents may still do the work).
- Size: use Linear **estimates** (XS/S/M/L → 1/2/3/5) instead of `size:*` labels.

---

## Agent workflow: claim → branch → PR → auto-close

1. **Discover claimable work.** Issues in state **Todo**, unassigned, labeled
   **`safe:agent`**:

   ```
   mcp__Linear__list_issues  team:aubreyslist  state:Todo  assignee:null  label:safe:agent
   ```

   `safe:human` items (auth, schema, deploys, external services) are still
   **workable** — that label gates the **merge**, not the work. Do the work and
   open the PR as normal; a human reviews, approves, and merges it. Never
   self-merge a `safe:human` change.

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

6. **Archive it once Done.** After the issue reaches **Done** (or `Canceled` /
   `Duplicate`), **archive it** so it drops out of the 250-issue budget. See
   *Issue hygiene* below — this is not optional.

> **GitHub, not Linear, still gates merge.** CI (`pr-title`, `pr-labels`,
> changelog) is unchanged. Linear tracks *what* and *why*; GitHub enforces *how
> it ships*.

---

## Issue hygiene: archive what you finish

> **Decision rule:** A completed issue that's still un-archived is dead weight
> counting against the cap. **Archive every issue you move to `Done`,
> `Canceled`, or `Duplicate`.** Free tier counts **non-archived** issues toward
> the hard **250** limit — and creation *blocks* with no grace period once you
> hit it. Archiving is how we stay under it.

- **When you finish work, archive the issue** in the same session — don't leave
  `Done` issues piling up. (`update_issue` / `save_issue` supports archiving; if
  the tool exposes it as a distinct action, use that.) Archived issues are fully
  recoverable, so there's no downside to archiving early.
- **Sweep periodically.** Any agent doing Linear housekeeping should archive
  lingering `Done` / `Canceled` / `Duplicate` issues it finds, not just its own.
- **Turn on auto-archive as a backstop** (team setting): auto-archive completed
  issues after the shortest offered interval. Belt-and-suspenders with the
  per-issue rule above — the manual rule is primary because it frees budget
  immediately.
- **Watch the headroom.** If `list_issues` (non-archived) approaches ~200, stop
  and archive before creating more, rather than hitting the block mid-task.

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

Migration complete (ADR-012):

- [x] Create the `aubreyslist` team (`AUB`).
- [x] Create labels: `Chore`, `Docs`, `safe:agent`, `safe:human`.
- [x] Port GitHub epics + issues into Projects/Issues. All 11 epics became
      Projects — the open `#8`/`#9`/`#178`/`#203` plus the closed `#1`–`#7`; the
      15 open work items became `AUB-*` Issues in **Backlog**; the ~85 historical
      completed issues were imported as **Done** (grouped under their epic
      Project, or a `v1 hardening & audits (historical)` bucket for issues with
      no epic). Every migrated GitHub issue/epic was closed with a pointer to its
      Linear counterpart, so GitHub now has **0 open issues**.

Linear (`AUB`) is now authoritative for all tracked work; the GitHub Issues list
(`docs/agents/issues.md`) is historical. Archive the imported `Done` issues in
the Linear UI to keep them off the 250-issue budget (see *Issue hygiene*) — the
API can't archive, so it's a manual/auto-archive step.
