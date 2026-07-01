# ADR-012: Linear as the planning/epic layer; GitHub stays the code layer

## Status

Accepted. Supersedes the "Why no Projects board" rationale in
`docs/agents/issues.md` (ADR-009 and the GitHub-Issues *code* workflow in
`docs/agents/tasks.md` are unaffected).

## Context

Epics were faked in GitHub with a `type:epic` label plus native sub-issues
because agents can't interact with GitHub Projects or Milestones
(`docs/agents/issues.md`). That gave hierarchy but no real planning surface —
no initiatives, no cycles, no board an agent can query and move work across.
Linear closes exactly that gap: it has first-class Initiatives → Projects →
Issues → sub-issues, and — as of its April 2026 release — an official **Agent +
MCP** interface plus GraphQL, so agents can plan and track against it directly.
The Linear MCP (`mcp__Linear__*`) is now connected to this environment.

## Decision

Adopt **Linear as the planning/epic layer** — the structured, agent-manipulable
home for initiatives, epics (Projects), and work items — while **GitHub remains
the code layer** (branches, PRs, review, CI, squash-merge). The two are bridged
by Linear's GitHub integration and magic-word links in branch/PR titles.
`aubreyslist` gets its **own Linear team** (key `AUB`); a free-tier team slot
was freed (the old `construct` team) to make room, keeping the free-tier 2-team
cap intact while giving the project its own 250-issue budget, cycles, and states.

## Consequences

- **Planning moves to Linear; do not create new `type:epic` GitHub issues.**
  Epics become Linear Projects; work items become Linear Issues. See
  `docs/agents/linear.md` for the structure, state/label mapping, and the
  agent claim → branch → PR → auto-close workflow.
- **GitHub PRs, CI, and the `docs/agents/tasks.md` merge flow are unchanged.** A
  PR still carries its Conventional-Commit title, labels, and changelog
  fragment; Linear's GitHub integration links the PR to its issue and
  transitions state on merge (In Review → Done).
- **`aubreyslist` = its own team (`AUB`).** Free tier = 2 teams (`aubreyslist`,
  `brbcoding`) + 250 non-archived issues per the plan. Archive/close
  aggressively; **do not auto-file an issue per Vercel toolbar comment**
  (`docs/agents/preview-feedback.md`).
- **The loop is pull.** No Vercel-comment webhook exists; agents check preview
  feedback and Linear state when dispatched or polled, not via push.
- **Migration is staged, not a big bang.** Until the two seed GitHub epics
  (`#8`, `#9`) and their children are ported to a Linear Project, the GitHub
  Issues list stays authoritative for in-flight work. New epics start in Linear.
- **`docs/agents/issues.md` is retained for historical/in-flight GitHub epics**
  but its "no Projects board" conclusion is superseded by this ADR.
