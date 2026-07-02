---
name: design-orchestration
description: Orchestrate a full page redesign end to end — design pass in Claude Design, file the tracked work + attach the artifact in Linear, hand off to a coding subagent, and open the PR. Use when the user asks to redesign / do a design pass over a page or screen. Every design PR is safe:human — the agent drives CI green but never self-merges.
---

# Design → Code Orchestration

You are the **Orchestrator** for a page redesign. This is a **pipeline**, not one
task: design pass → tracked work in Linear → coding hand-off → PR the human ships.
Delegate each phase to **subagents**; you hold the sequencing and the ship call.

## The one rule that never bends

**Every design PR is `safe:human`. Never self-merge a design change** — not with
green CI, not with a `SHIP` review verdict. Drive CI green, then stop and hand it
to the human (Aubrey) to review and merge. This is deliberate friction against
bad design cycles reaching production.

## Checklist

1. **Read the playbook.** Open `docs/agents/design-orchestration.md` — full
   phases, roles, the subagent map, Linear structure, the human gate, and stop
   conditions. It is the source of truth; this skill only routes you. It composes
   the existing sub-docs (`design.md`, `styling.md`, `domain.md`, `linear.md`,
   `orchestration.md`, `tasks.md`) — read what each phase points to.
2. **Confirm the target.** The page/route to redesign (e.g.
   `app/routes/listings.index.tsx`) and an optional brief. If missing, ask.
3. **Run the phases** (delegating to subagents throughout):
   - **P0 Setup** — read the design docs; self-provision the Linear scaffolding
     (design project + `Design` label), creating only what's missing.
   - **P1 Design pass** — a Design-analyst subagent briefs Claude Design per
     `docs/agents/design.md` and returns the artifact + an ordered change list.
   - **P2 File in Linear** — create the issue in the design project, attach the
     artifact, label **`Design` + `safe:human`** + a type label, estimate, `Todo`.
   - **P3 Hand-off** — claim → branch off `main` → a coding Worker subagent
     implements to match the artifact → run the **`review-loop`** skill (fresh
     adversarial Reviewer, 2-round cap) → `pnpm preflight`.
   - **P4 Ship** — open the PR (`Fixes AUB-<n>`, `safe:human`, changelog
     fragment, `## Adversarial review` block); move issue to `In Review`;
     subscribe to PR activity and drive CI green; **stop for the human to merge**;
     archive the issue after merge.
4. **Respect the gate and the cap.** `safe:human` on every design PR; one
   coherent redesign = one issue (don't file per micro-tweak — the 250-issue cap
   is real).

## Subagent map (lean on subagents)

| Subagent           | Does                                                        |
| ------------------ | ---------------------------------------------------------- |
| **Design analyst** | Reads the page + design docs, briefs Claude Design, returns artifact + change list |
| **Coding Worker**  | Implements the redesign to match the artifact (one per issue) |
| **Reviewer**       | Fresh, adversarial each round — via the `review-loop` skill  |

The Orchestrator (not a subagent) owns all Linear/GitHub writes so tracking stays
coherent. See `docs/agents/design-orchestration.md` for the details of each phase.
