---
name: orchestrate
description: Run a session as the orchestrator — Linear recon, worker dispatch by model tier, adversarial review, labeled PR, safe:agent self-merge or safe:human handoff. Use at the start of every session before multi-step work (CLAUDE.md directs every session here).
---

# Orchestrate (Session Default)

Every session in this repo is an **orchestrator** — a standing owner
expectation, applied without being asked. The docs are the source of truth;
this skill routes you: `docs/agents/orchestration.md` (loop, model tiers, merge
runbook), `docs/agents/linear.md` (tracking), `docs/agents/tasks.md` (PR
conventions), `docs/agents/governance.md` (owner-gated surfaces).

**Review routing:** the lenses a PR owes come from its changed-file list. A
prose-only diff routes conventions + copy; every other diff routes the full
panel. Prose is an allowlist, so any unlisted path is full-panel — `AGENTS.md`,
`CLAUDE.md`, `docs/agents/**`, `docs/decisions/**`, and `.claude/**` included.
Answering a question changes no files, so there is no PR and no gate.

## Session lifecycle

1. **Linear recon.** List/search team `AUB` projects and issues FIRST — no
   duplicate issues, respect the 250-issue budget. Claim the issue (or create
   one if genuinely new), then branch (`docs/agents/linear.md`).
2. **Decompose** the task into work units, each with an explicit spec +
   acceptance criteria.
3. **Dispatch workers.** Deliberately pick each subagent's model tier — the
   table lives in `docs/agents/orchestration.md`.
4. **Review.** Run the `review-loop` skill on every worker output — the
   specialist review panel, fresh reviewer per lens, 2 reviews per lens;
   escalate unresolved items in the PR description.
5. **Ship the PR.** Conventional-Commit title; one each of `type:*` / `size:*`
   / `safe:*`; `## TL;DR`; an `## Adversarial review` block with a verdict for
   every routed lens + `review:adversarial-passed`; `changelog.d/` fragment (or
   `skip-changelog`); `Fixes AUB-<n>`. Check the owner-review gate: if the diff
   touches an owner-gated surface it MUST be `safe:human`
   (`docs/agents/governance.md` — a local check command lives there).
6. **Merge or hand off.**
   - `safe:agent`: follow the self-merge runbook in
     `docs/agents/orchestration.md` — babysit CI, fix reds, resolve conflicts,
     squash-merge on green.
   - `safe:human`: drive CI green, then stop and prompt the human. The session
     owner reviews non-owner-gated PRs; @tonytino reviews owner-gated ones.
7. **Closeout.** `Fixes AUB-<n>` auto-transitions the issue on merge; archive
   it (250-issue budget); unsubscribe PR activity.

## Talking to the human

Prefer AskUserQuestion over questions embedded in prose — structured prompts
surface across the owner's many parallel sessions; inline questions get missed.
An unresponsive human is busy, not broken: keep the session alive, re-ask, and
never fabricate an answer to a blocking question.

## Hard rules

- A Reviewer is never the Worker — fresh, adversarial subagent every round.
- Never merge (or enable auto-merge on) a `safe:human` PR.
- Never ship a PR whose routed lenses lack a verdict.
- Never create a duplicate Linear issue.
- Owner-gated ⇒ `safe:human`, no exceptions.
