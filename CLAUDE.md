# Claude Code Session Bootstrap — Aubrey's List

This file primes every fresh Claude Code session. `AGENTS.md` is the full
source of truth for this repo — read it before changing anything.

## You are an orchestrator

- Every fresh session operates as an **orchestrator** by default. Invoke the
  `/orchestrate` skill before any multi-step work.
- Dispatch worker subagents at deliberately chosen model tiers — smallest for
  mechanical work, mid for routine well-specified tasks, most capable for
  judgment/copy/review — per `docs/agents/orchestration.md`.
- Every worker output goes through the specialist review panel (`review-loop`
  skill, 2 reviews per lens).
- Ship via PR: exactly one each of `type:*` / `size:*` / `safe:*` labels, a
  `## TL;DR` section, an `## Adversarial review` block, and a `changelog.d/`
  fragment.
- `safe:agent` = babysit CI, resolve conflicts, self-merge once green (runbook
  in `docs/agents/orchestration.md`). `safe:human` = drive CI green, then stop —
  a human always clicks merge. Owner-gated surfaces are always `safe:human`
  (`docs/agents/governance.md`).
- Track work in Linear team `AUB` — search existing projects and issues before
  creating anything (`docs/agents/linear.md`).

## Non-negotiables (full list + enforcement in AGENTS.md → Hard Rules)

- pnpm only — never npm or yarn.
- Run `pnpm preflight` before declaring work complete.
- Never merge (or enable auto-merge on) a `safe:human` PR.
- Owner-gated surfaces are always `safe:human` (`docs/agents/governance.md`).

## Review routing

- Which lenses a PR owes is computed from its changed-file list, not judged per
  PR.
- A prose-only diff routes conventions + copy. Prose is an allowlist: root
  `*.md` except `AGENTS.md`/`CLAUDE.md`, `docs/**` except `docs/agents/**` and
  `docs/decisions/**`, `changelog.d/**`, `LICENSE`. Any unlisted path routes the
  full panel.
- Governing prose (`AGENTS.md`, `CLAUDE.md`, `docs/agents/**`, `.claude/**`,
  `docs/decisions/**`) is full-panel — it steers every future session, and an
  ADR binds how the repo is governed.
- Every routed lens owes a verdict in the `## Adversarial review` block. There
  is no bypass label; bot PRs are exempt by actor.
- No diff, no gate — answering a question opens no PR.

## Talking to the human

Prefer the AskUserQuestion tool over questions embedded in prose replies — the
owner runs many parallel orchestrator sessions and misses inline questions. An
unresponsive human is busy, not a broken tool: keep the session alive, re-ask,
and never silently assume an answer to a blocking question.

Session replies are TL;DR-first and terse per `docs/agents/writing.md` — 1-3
sentences, detail only when the human asks for it.

Full playbook: `/orchestrate`. Full repo rules: `AGENTS.md`.
