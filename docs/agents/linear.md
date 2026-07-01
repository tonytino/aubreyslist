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

## GitHub integration: PR linking vs. Issues Sync

Linear's GitHub integration is **two independent features**. We rely on the
first; the second is a deliberate *no* on the current plan.

**1. PR / branch linking (magic words) — in use, free tier.** Branch name or PR
body carries `Fixes AUB-123` (see the claim → PR flow above). Merging the PR
transitions the linked issue **In Review → Done**. This is the backbone of the
Linear ↔ GitHub bridge and needs no per-issue mirroring. Nothing here counts
extra against the 250-issue cap — the Linear issue already exists.

**2. GitHub **Issues Sync** — a mirror of GitHub issues ↔ Linear issues.** A
separate feature that imports issues from a linked GitHub repo into Linear and
keeps them **bidirectionally** in sync (title, description, state, labels,
assignee, comments flow both ways). This is what would remove future manual
GitHub→Linear ports.

### Findings (researched 2026-07-01)

- **Plan tier:** Issues Sync is **available on the free tier** — it is *not*
  gated to paid plans. Only advanced agentic features (Code Intelligence, AI
  agents on PRs) require Business/Enterprise. So feasibility is not the blocker.
- **Directionality:** two-way by default. Closing/editing on either side
  propagates to the other.
- **Scoping:** configured **per repo → team** link (Settings → Integrations →
  GitHub → Connected organizations → **+**, then pick the repo and the `AUB`
  team). Repo-level selection is the reliable scoping lever. **Native inbound
  label-filtering ("only sync GitHub issues labeled X") is *not* confirmed** —
  the native integration appears to import at repo granularity; selective
  label-gated sync is a third-party (`synclinear`) capability. Treat label
  scoping as **unverified until checked in the Linear UI at setup time.**
- **250-cap interaction:** every synced GitHub issue becomes a non-archived
  Linear issue counting against the hard **250** limit. Linking a busy repo
  with no label filter can exhaust the budget quickly.
- **Archive-on-done interaction:** because state syncs both ways, archiving a
  Linear issue whose GitHub counterpart is still **open** risks churn or
  resurrection. Only archive when the issue is closed on **both** sides.
- **Double-track tension:** Issues Sync creates exactly the GitHub-issue ↔
  Linear-issue mirror the Boundaries table warns against. For planned agent work
  (which starts in Linear and links via PR magic words) it is redundant.

### Decision: don't enable blanket Issues Sync (revisit if GitHub-native volume grows)

Default to **keeping Issues Sync off.** Planned work starts in Linear (ADR-012);
GitHub-native issues are the exception, so triage the occasional one by hand
rather than paying the cap + double-track cost of a standing bidirectional
mirror. The one-time bulk port that motivated this task is not an ongoing
burden.

If GitHub-native issue volume later justifies auto-sync, enable it **narrowly**:
scope to a single repo, and **first verify in the Linear UI whether inbound
issues can be label-filtered.** If they can't, do **not** link a high-traffic
repo — an unfiltered link is the fastest way to blow the 250-issue budget.

### Human setup (OAuth — agents can't click through this)

Whoever enables it needs Linear **admin** + GitHub **org owner**:

1. Settings → Integrations → GitHub → connect the org (this also powers PR/branch
   linking — the piece the rollout checklist below actually requires).
2. *(only if enabling Issues Sync)* Connected organizations → **+** → select the
   repo and the `AUB` team; check for a label-scoping option **before** linking;
   choose one-way vs two-way. Leave off unless the volume case is real.

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
- [ ] Confirm Linear ↔ GitHub integration links PRs and transitions state
      (PR/branch magic words — the *first* feature under *GitHub integration*
      above; human must connect the org in the Linear UI).
- [x] Evaluate GitHub **Issues Sync**: free-tier-supported but **intentionally
      left off** — see the decision under *GitHub integration* above. Keep
      opening planned work directly in Linear.

Until ported, the GitHub Issues list (`docs/agents/issues.md`) stays
authoritative for in-flight work; **new** epics start in Linear.
