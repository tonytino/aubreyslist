# Orchestrating Multi-Agent Work

> **When orchestrating multi-agent work, run every worker output through the
> adversarial review loop below — cap at 2 review rounds.** Never ship a
> subagent's code, docs, or change until an independent, fresh Reviewer has
> tried to break it. The loop is enforced deterministically by the committed
> `.claude/workflows/adversarial-review.mjs` workflow; the `review-loop` skill is
> the one-line entry point.

---

## Roles

| Role             | Responsibility                                                                         |
| ---------------- | -------------------------------------------------------------------------------------- |
| **Orchestrator** | Decomposes the task, dispatches workers, runs the review loop, makes the final ship call. |
| **Worker**       | Produces an output (code/docs/change) against an explicit spec + acceptance criteria.   |
| **Reviewer**     | A **fresh, adversarial** subagent that actively tries to break or refute the work.      |

The Reviewer must be a **new subagent each round** — never the worker reviewing
itself, never a reused context. Adversarial independence is the point.

---

## The Loop

1. **Dispatch.** The Orchestrator decomposes the task and sends a **Worker**
   subagent to produce the output, handing it an **explicit spec + acceptance
   criteria**.
2. **Round 1 review.** The Orchestrator spawns a **fresh Reviewer** with the
   adversarial mandate (try to break/refute the work). The Reviewer checks every
   dimension below and returns the structured verdict.
3. **Address findings.** If the verdict is `CHANGES_REQUESTED`, the Orchestrator
   sends the **ORIGINAL Worker** back — preserving its context — to handle each
   finding by either **fixing** it or **rebutting** it with a concrete
   justification.
4. **Round 2 review.** A **fresh Reviewer** re-checks the updated output plus the
   worker's responses to each finding.
5. **Stop.** Ship if clean. If items remain contested after round 2, the
   Orchestrator makes the call and **escalates the unresolved items to the human
   in the PR description** rather than looping further.

---

## Review Dimensions

The Reviewer must adversarially probe each of these:

| Dimension                  | What to attack                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| **Correctness**            | Logic bugs, edge cases, wrong assumptions, broken behavior.                                          |
| **Security**               | Injection, secret exposure, missing authz, unsafe input handling.                                   |
| **Hard Rules**             | Any violation of the repo Hard Rules in `AGENTS.md` (`process.env`, `any`, `db` on client, etc.).   |
| **Trust-model invariants** | ADR-007 transparent-evidence trust (no hidden scoring) and ADR-008 intake/dedup (Place ID key, manual fallback) must hold. |
| **Test honesty**           | No skipped, weakened, or missing tests for new code; `pnpm preflight` must pass.                     |
| **Scope creep**            | Unrequested changes, gold-plating, drive-by edits outside the spec.                                  |
| **Documentation drift**    | Docs that no longer match the code/behavior the change introduced.                                  |

---

## Verdict Schema

The Reviewer returns exactly this structure:

```json
{
  "findings": [
    {
      "severity": "blocker" | "major" | "minor",
      "area": "string",
      "summary": "string",
      "verdict": "CONFIRMED" | "PLAUSIBLE" | "REFUTED",
      "required_change": "string"
    }
  ],
  "overall": "SHIP" | "CHANGES_REQUESTED",
  "notes": "string"
}
```

`overall` is `SHIP` only when no `blocker` or `major` finding stands
`CONFIRMED` or `PLAUSIBLE`; otherwise `CHANGES_REQUESTED`.

---

## Stop Condition / Hard Cap

- **Maximum 2 review rounds.** Do not loop further.
- Ship as soon as a round returns `SHIP`.
- After round 2, any finding still contested (worker rebutted, Reviewer
  unconvinced) is **not** re-litigated by spawning more rounds. The Orchestrator
  decides whether to ship and **escalates each unresolved item to the human**.

### Escalating unresolved items into the PR body

When shipping with unresolved items after the cap, add a section to the PR
description so the human reviewer sees exactly what is contested:

```md
## Unresolved review items (escalated after 2-round cap)
- **[major] <area>** — <summary>. Worker's rebuttal: <…>. Reviewer's concern: <…>.
- **[minor] <area>** — …
```

Keep it factual: the finding, the worker's rebuttal, and why it stayed
contested. Do not silently drop a `CONFIRMED` blocker — if one remains, do not
ship.

---

## How to Invoke

- **Skill (preferred entry point).** Run the `review-loop` skill
  (`.claude/skills/review-loop/`). It reads this playbook and routes you to the
  right execution path.
- **Workflow (deterministic batch fan-out).** For batch work, delegate to
  `.claude/workflows/adversarial-review.mjs`. The committed workflow enforces the
  2-round cap and guarantees **every worker output receives at least one review
  in code, not by model discretion**.
- **Manual (interactive single task).** For one-off interactive work, run the
  loop yourself via Agent-tool calls, following the numbered loop above. Spawn a
  fresh Reviewer each round and respect the 2-round cap.
