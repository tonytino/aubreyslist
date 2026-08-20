# Orchestrating Multi-Agent Work

> **When orchestrating multi-agent work, run every worker output through the
> adversarial review loop below — cap at 2 review rounds.** Never ship a
> subagent's code, docs, or change until an independent, fresh Reviewer has
> tried to break it. The loop is enforced deterministically by the committed
> `.claude/workflows/adversarial-review.mjs` workflow; the `review-loop` skill is
> the one-line entry point.

Every session is an orchestrator by default — `CLAUDE.md` and the `/orchestrate`
skill route here; this doc is the playbook.

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

## Tiny-task exception

Orchestration is the default for **all real work**. Direct handling — no
workers, no review loop — is allowed only for: answering questions that change
no files, and typo-class / one-line doc fixes. Committed changes still ship as
a conventional PR with the full label set and `## TL;DR`; `skip-review` (and
`skip-changelog` where genuinely trivial) are the sanctioned bypass labels.

---

## Choosing a model per subagent

**The Orchestrator deliberately picks each subagent's model per task, using its
own judgment.** This is a standing owner expectation — apply it without being
asked. Model names change; think in tiers:

| Tier | Use for |
| --- | --- |
| Smallest/fastest (e.g. Haiku) | Mechanical scans, greps, bulk enumeration. |
| Mid (e.g. Sonnet) | Routine, well-specified searches and edits. |
| Most capable available (the session's default model or better) | Writing user-facing copy or docs, adversarial review, anything requiring judgment or ambiguity resolution. |

When unsure, default to inheriting the session model.

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
| **URL-state hygiene**      | Shareable/restorable UI state (filters, sort, search, page, tab) kept in `useState` instead of the URL; default params leaking into the querystring; a client-only param wrongly added to `loaderDeps` (spurious refetch) or a server param not resetting `page`. See `docs/agents/url-state.md`. |
| **Prose terseness**        | History narration, ticket IDs in comments, comments restating the code, bloated docs or PR bodies. See `docs/agents/writing.md`. |

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

## CI enforcement (the `adversarial-review` gate)

The loop is enforced as a hard PR gate by the `adversarial-review` job in
`.github/workflows/pr-conventions.yml`. (Dependabot PRs are exempt — a bot can't
run the review loop; they remain covered by the `owner-review` gate and
CODEOWNERS, see the job's comment.) To merge, any other PR must satisfy **one** of:

- **`skip-review` label** — bypasses the gate for a trivial or human-only change; **or**
- **both** the **`review:adversarial-passed` label** **and** a well-formed
  **`## Adversarial review`** section in the PR body. That section must contain
  either a passing verdict (`overall: SHIP`, the verdict above) or the escalation
  block (`Unresolved review items (escalated after 2-round cap)`). An empty or
  template-placeholder section fails. The exact rule lives in the header of
  `.github/scripts/check-review-block.mjs` (`validateReviewBlock`). The job
  re-evaluates on `labeled`/`unlabeled`/`edited`, so adding the label or pasting
  the verdict re-runs it.

**Honest limitation.** CI cannot prove a genuine review occurred — the body block
could be fabricated and the `review:adversarial-passed` label hand-applied. This
gate is a **forcing function plus an auditable record**, not cryptographic proof.
Likewise `skip-review` is a **human judgement call**: CI cannot enforce *who*
applied it or that the change truly warranted skipping. Treat both as social
contracts the gate makes visible, not guarantees.

**Relationship to the owner-review gate.** The adversarial-review loop is a
self/peer check that any reviewer can clear. It does **not** replace the
owner-review guardrail (`docs/agents/governance.md`): when a change touches an
owner-gated surface (cost / legal / security / trust & safety / destructive data /
privacy / safety-disclaimer), the **Trust-model invariants** and **Security**
dimensions above must be probed *and* the PR is `safe:human` — merged by the owner
via CODEOWNERS + branch protection, which no review record or label can bypass.

---

## Shipping the PR: the `safe:agent` self-merge runbook

This runbook applies **only** to PRs labeled `safe:agent` ("Agent may merge the
PR once CI passes"). For `safe:human` PRs, see the next section.

1. **Babysit CI.** After opening the PR, subscribe to PR activity
   (`subscribe_pr_activity` via the GitHub MCP, or your harness's equivalent).
   Diagnose red checks from the job logs, push fixes, and re-drive. Escalate to
   the human instead of looping forever on a failure that is out of the PR's
   scope.
2. **Merge conflicts are your job.** Rebase onto `main` (or merge `main` in),
   resolve, and re-drive CI — don't hand conflicts to the human.
3. **Preconditions before merging** — verify all of:
   - All required checks are green.
   - `review:adversarial-passed` plus a well-formed review block (or
     `skip-review`) satisfy the adversarial-review gate.
   - No `CONFIRMED` blocker or major finding stands.
   - The `owner-review` job passed with the PR labeled `safe:agent`. If it
     flags the diff as owner-gated, relabel `safe:human` and switch to the
     handoff path (`docs/agents/governance.md`).
4. **Merge: squash.** Repo policy — the PR title becomes the squash commit,
   which is why the `pr-title` job runs commitlint against it. Use the GitHub
   MCP `merge_pull_request` with `merge_method: "squash"`, or
   `gh pr merge --squash --delete-branch` locally. Never rewrite the title at
   merge time.
5. **Cleanup.** Delete the branch and unsubscribe from PR activity.
6. **Linear closeout.** `Fixes AUB-<n>` auto-transitions the issue to Done on
   merge; **archive it** to stay under the 250-issue budget
   (`docs/agents/linear.md`).

---

## Who reviews a `safe:human` PR

**Default: the session owner.** The human driving the orchestrating session
reviews and merges their own agents' `safe:human` PRs — design PRs and other
judgment-call changes in non-owner-gated paths.

**Exception: owner-gated surfaces.** Those always require **@tonytino** per
`docs/agents/governance.md`. Caution: the process/config surfaces are
themselves owner-gated paths — `AGENTS.md`, `/.github/`, `docs/decisions/`,
`scripts/labels.mjs`, `package.json`, and the root configs. Owned **paths**
are hard-blocked by CODEOWNERS + branch protection regardless of who else
approves; the **content** categories rely on the best-effort `owner-review`
CI tripwire (see governance.md's "Known limitations").

As an agent: request the right reviewer and say so in the PR's "Notes for
reviewer" section; the PR stays open until that human merges it. **Never merge
— or enable auto-merge on — any `safe:human` PR** (Hard Rule in `AGENTS.md`).

---

## Talking to the human

Prefer **AskUserQuestion** for any decision that needs human input. Structured
prompts surface across the owner's many parallel sessions; questions embedded
mid-response get missed. One question-set with concrete options beats a
paragraph ending in "thoughts?".

An **unresponsive human is busy, not broken**: keep the session alive, re-ask
periodically, park non-blocking work and continue what you can — and never
fabricate an answer to a blocking question. In a harness without the tool, put
the question in the FIRST line of the reply, prefixed `QUESTION FOR HUMAN:`.

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
