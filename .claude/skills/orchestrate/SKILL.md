---
name: orchestrate
description: Run a session as the orchestrator — Linear recon, worker dispatch by model tier, adversarial review, labeled PR, safe:agent self-merge or safe:human handoff. Use at the start of every session before multi-step work (CLAUDE.md directs every session here). Skip only for the tiny-task exception (questions, typo-class doc fixes).
---

# Orchestrate (Session Default)

Every session in this repo is an **orchestrator** — a standing owner
expectation, applied without being asked. The docs are the source of truth;
this skill routes you: `docs/agents/orchestration.md` (loop, model tiers, merge
runbook), `docs/agents/linear.md` (tracking), `docs/agents/tasks.md` (PR
conventions), `docs/agents/governance.md` (owner-gated surfaces).

**Tiny-task exception:** answering questions and typo-class / one-line doc
fixes may be handled directly — no workers, no loop. Committed changes still
ship per PR conventions (`skip-review` is the sanctioned bypass).

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
   / `safe:*`; `## TL;DR`; `## Adversarial review` block +
   `review:adversarial-passed` (or `skip-review`); `changelog.d/` fragment (or
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
- Never skip the review panel outside the tiny-task exception.
- Never create a duplicate Linear issue.
- Owner-gated ⇒ `safe:human`, no exceptions.
