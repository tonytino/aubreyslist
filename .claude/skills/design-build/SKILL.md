---
name: design-build
description: Part B of a page redesign — pick up Linear issues the human has approved (Design + design:approved), implement them to match the Claude Design artifact via a coding subagent, run the specialist review panel, and open a safe:human PR. Use when the user asks to build / ship an approved design, or run /design-build. Design PRs are always safe:human — drive CI green but never self-merge.
---

# Design Build (Part B)

You run the **coding half** of a page redesign, on designs the human has already
approved. Read the full playbook in `docs/agents/design-orchestration.md` (source
of truth); this skill routes you.

## The gate and the one hard rule

1. **Only build `design:approved` issues.** The label is the human's sign-off from
   reviewing the design in Claude Design. No label → do not touch it.
2. **Every design PR is `safe:human`. Never self-merge** — not with green CI, not
   with a `SHIP` verdict. Drive CI green, then hand the PR to the human to review
   and merge.

## Checklist

1. **Read** `docs/agents/design-orchestration.md`, and the flow it points to:
   `docs/agents/linear.md` (claim→branch→PR), `docs/agents/orchestration.md` +
   the `review-loop` skill (adversarial review), `docs/agents/styling.md`
   (implementation rules), `docs/agents/tasks.md` (PR conventions).
2. **Discover approved work:**
   `list_issues team:aubreyslist label:Design label:design:approved assignee:null`.
   If none, report and stop. Skip anything lacking `design:approved`.
3. **Claim → branch.** `save_issue` (assignee `me`, state `In Progress`); branch
   off `main` using the git branch name `get_issue` returns.
4. **Implement via a Worker subagent.** Dispatch a **coding Worker** with the
   artifact + change list + acceptance criteria as its spec. Constraints: Tailwind
   utilities only (no inline styles / `@apply`), the repo **Hard Rules**, and
   `docs/agents/styling.md`. It writes code + tests.
5. **Specialist review panel.** Run the **`review-loop`** skill / the
   `adversarial-review` workflow — fresh reviewer per lens, 2 reviews per lens.
   Beyond the standard lenses, the panel attacks: safety signals still pair
   **color + icon + label**, **WCAG AA** holds, **mobile-first** survives, and the
   result **matches the artifact**. Then **`pnpm preflight`**.
6. **Open the PR** with `Fixes AUB-<n>`, **`safe:human`** + required `type:*` /
   `size:*` labels, a `changelog.d/` fragment, and the `## Adversarial review`
   block. Move the issue to **`In Review`**.
7. **Drive CI green, then stop.** Subscribe to PR activity (`subscribe_pr_activity`)
   and re-kick on failures until green — then **hand it to the human to merge**.
   Never self-merge. After merge, archive the Linear issue (250-issue cap).

## Hard rules

- **The Worker codes; the Orchestrator writes to Linear and opens the PR.**
- **A Reviewer is never the Worker** — fresh, adversarial subagent every round.
- **One issue = one Worker = one PR.**
