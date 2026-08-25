# ADR-015: Owner-review guardrails for agent-driven contribution

## Status

Accepted

## Context

The project is opening up to non-owner contributors (data scientists, PMs,
designers) who drive agents to deliver features. The owner wants them to ship
**most** changes autonomously, but requires his **own explicit review** for
high-caliber changes — those that affect cloud cost, carry legal ramifications,
pose security risk, or are of similar caliber. That approval must come from him
(not a bot on his behalf) and must not be bypassable or loosenable by anyone else,
including via the guardrail's own configuration.

The repo already enforced a `safe:agent` / `safe:human` label per PR, but nothing
forced a high-caliber change to be `safe:human`; `safe:human` meant "any human,"
not the owner specifically; and there was **no `CODEOWNERS` file**, so GitHub's
only identity-bound, unbypassable review mechanism was unused.

## Decision

Adopt a **two-layer** guardrail over **seven owner-gated categories** (cost,
legal, security, trust & safety model, destructive/irreversible data changes,
data-collection/privacy posture, and safety/medical-disclaimer copy). **Layer 1**
is `.github/CODEOWNERS` assigning only the gated paths to `@tonytino` plus branch
protection requiring code-owner review with no bypass — the unbypassable teeth.
**Layer 2** is a zero-dep CI detector (`check-owner-review.mjs`, driven by
`owner-review-paths.mjs`) that fails any PR touching a gated surface unless it is
labeled `safe:human` — a forcing function with no bypass label. A human always
merges `safe:human` PRs; agents never do.

## Consequences

- **Most PRs are unaffected.** Only the enumerated gated paths (and a few content
  signals) require the owner; everything else ships `safe:agent` on green CI.
- **The gated surface has one source of truth** — `.github/scripts/owner-review-paths.mjs`
  — mirrored in `.github/CODEOWNERS`; a bidirectional drift test
  (`tests/unit/check-owner-review.test.ts`) fails the build if they diverge. Update
  both together.
- **Agents must not merge or auto-merge a `safe:human` PR**, and must not take any
  human-impersonating action the human would disapprove of. This is now a Hard
  Rule in `AGENTS.md`.
- **No bypass label exists** for the owner-review gate. The only way past a gated
  change is the owner's own review + merge.
- **The guardrail is self-protecting:** CODEOWNERS, workflows, guard scripts, and
  the CI-config surface are owner-owned, so loosening any gate needs the owner's
  review.
- **Branch protection is an owner-only, out-of-repo step** (documented in
  `docs/agents/governance.md`). Until it is configured, Layer 2 CI is a
  forcing function but not unbypassable; the owner completes Layer 1 in Settings.
- **Cost that path-ownership can't see** (client-driven API fan-out) is backstopped
  out-of-band by Google Cloud quota/budget alerts and Neon/Vercel spend alerts
  (Linear AUB-49), not by this gate.

See `docs/agents/governance.md` for the operational guide and the owner setup
checklist.
