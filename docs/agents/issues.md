# Issue & Epic Organization

> **Decision rule:** Claim **work items** (the `status:ready` + `safe:agent`
> units in the default issue list). **Never claim an epic.** An epic is a parent
> grouping carrying the `type:epic` label; you work an epic by working its
> sub-issues, not the epic itself.

Tasks are tracked as **GitHub Issues** (see `docs/agents/tasks.md` for the
claim/execution protocol). This doc covers how those issues are organized into
epics and work items.

---

## Two kinds of issue

| Kind          | Label        | Claimable?                          | Appears in default list? |
| ------------- | ------------ | ----------------------------------- | ------------------------ |
| **Epic**      | `type:epic`  | No — work its sub-issues instead    | No (filtered out)        |
| **Work item** | `type:*` (bug/feature/chore/docs) | Yes, when `status:ready` + `safe:agent` | Yes |

- **Epics** are parent groupings (e.g. "EPIC 7 — Deploy & launch"). They carry
  `type:epic` and link their work items via **native GitHub sub-issues**. An
  epic is done when its sub-issues are done; it holds no directly executable
  scope of its own.
- **Work items** are the scoped, single-session units an agent actually claims.
  These are what the default discovery query surfaces.

The `type:epic` label is what keeps epics out of the claimable list, so agents
discovering work see only real, executable units.

---

## Viewing & filtering

```bash
# Default claimable work (epics are excluded because they aren't status:ready)
gh issue list --label "status:ready,safe:agent" --assignee "" --state open

# Explicitly hide epics from any list
gh issue list -- -label:type:epic

# Just the epics
gh issue list --label "type:epic"
```

GitHub's native sub-issue search qualifiers also work in the issues UI and API:

- `-has:parent` — top-level issues only (epics and standalone items).
- `has:parent` — only issues that are a sub-issue of some epic.

Web sessions use the GitHub MCP tools (`mcp__github__*`); the filters are the
same, expressed as search queries.

---

## Working an epic

1. Open the epic to see its linked sub-issues (the native sub-issue list, not
   just body text).
2. Pick a sub-issue that is `status:ready` + `safe:agent` and claim **it** per
   `docs/agents/tasks.md`.
3. Do not relabel or close the epic yourself. It closes when its sub-issues are
   resolved.

> The two seed epics (`#8`, `#9`) predate this convention: they carry
> `type:epic` but still list their children as a checklist in the epic **body**
> rather than as native sub-issue links. Back-linking them as native sub-issues
> is a tracked follow-up; new epics should use native sub-issues from the start.

---

## Why no Projects board

A full **GitHub Projects board was deliberately not adopted**: agents in this
environment can't create or interact with a Projects board, so epics +
`type:epic` + native sub-issues are the organizing mechanism instead.
