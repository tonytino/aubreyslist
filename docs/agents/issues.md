# Issue & Epic Organization (GitHub — historical)

> **Superseded by ADR-012.** Planning and epics live in **Linear**
> (`docs/agents/linear.md`). This doc remains for the seed GitHub epics (`#8`,
> `#9`) and any in-flight GitHub-native work. **New epics start in Linear, not
> as `type:epic` issues.**

> **Decision rule:** Claim **work items** (the `status:ready` + `safe:agent`
> units in the default issue list). **Never claim an epic.** An epic is a parent
> grouping carrying the `type:epic` label; work an epic by working its
> sub-issues.

The claim/execution protocol is in `docs/agents/tasks.md`.

## Two kinds of issue

| Kind          | Label        | Claimable?                          | Appears in default list? |
| ------------- | ------------ | ----------------------------------- | ------------------------ |
| **Epic**      | `type:epic`  | No — work its sub-issues instead    | No (filtered out)        |
| **Work item** | `type:*` (bug/feature/chore/docs) | Yes, when `status:ready` + `safe:agent` | Yes |

Epics link their work items via native GitHub sub-issues and hold no directly
executable scope; an epic is done when its sub-issues are done. The `type:epic`
label keeps epics out of the claimable list.

## Viewing & filtering

```bash
# Default claimable work (epics are excluded because they aren't status:ready)
gh issue list --label "status:ready,safe:agent" --assignee "" --state open

# Explicitly hide epics from any list
gh issue list -- -label:type:epic

# Just the epics
gh issue list --label "type:epic"
```

Native sub-issue search qualifiers (issues UI and API):

- `-has:parent` — top-level issues only (epics and standalone items).
- `has:parent` — only sub-issues of some epic.

Web sessions use the GitHub MCP tools (`mcp__github__*`) with the same filters
as search queries.

## Working an epic

1. Open the epic to see its linked sub-issues (the native sub-issue list, not
   just body text).
2. Pick a sub-issue that is `status:ready` + `safe:agent` and claim **it** per
   `docs/agents/tasks.md`.
3. Do not relabel or close the epic yourself. It closes when its sub-issues are
   resolved.

> The two seed epics (`#8`, `#9`) list their children as a body checklist rather
> than native sub-issue links; back-linking them is a tracked follow-up. New
> epics use native sub-issues from the start.
