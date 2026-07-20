# Contributing to Aubrey's List

This repo is **agent-first**: contributors mostly direct orchestrator agent
sessions rather than writing code by hand. `AGENTS.md` and the sub-docs in
`docs/agents/` govern agent behavior — this file covers what *you*, the human,
need to know.

## No spiel needed

Claude Code sessions bootstrap themselves as orchestrators automatically:
`CLAUDE.md` is auto-loaded, a SessionStart hook (`.claude/settings.json`)
re-states the directive, and the `/orchestrate` skill carries the playbook.
Just state your goal. Using another harness? Point your agent at `AGENTS.md` →
"Default Operating Mode: Orchestrator" and it has everything it needs.

## How merging works

- **`safe:agent` PRs self-merge** once CI is green — the orchestrating session
  babysits CI, resolves conflicts, and squash-merges without you.
- **`safe:human` PRs are reviewed and merged by YOU, the session owner.** You
  review your own agents' work — that's the design, not a loophole. Your
  agents drive CI green, then stop and wait for you.
- **Exception: owner-gated surfaces** — changes touching an owner-gated
  surface; the categories are defined in `docs/agents/governance.md`, and the
  exact files live in `.github/scripts/owner-review-paths.mjs` (the single
  source of truth), mirrored in `.github/CODEOWNERS`. Only
  **@tonytino** can approve and merge those — owned paths are hard-blocked by
  CODEOWNERS + branch protection, while the content-only categories rely on
  the best-effort `owner-review` CI tripwire (see governance.md's "Known
  limitations").

## Expect questions

Your agents ask questions via structured prompts (AskUserQuestion) and wait
patiently for the answer. If you run several sessions in parallel, check each
one for pending questions — a quiet session usually isn't broken, it's waiting
on you.

## Work tracking

Tracked work lives in Linear team `AUB`. Agents search existing projects and
issues before filing new ones — don't double-track by mirroring the same work
in GitHub issues. Pointers: `docs/agents/linear.md` (workflow),
`docs/agents/tasks.md` (PR conventions), `changelog.d/README.md` (changelog
fragments).
