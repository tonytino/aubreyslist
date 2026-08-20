# Orchestrating Multi-Agent Work

> **When orchestrating multi-agent work, run every worker output through the
> specialist review panel below — cap at 2 reviews per lens.** Never ship a
> subagent's code, docs, or change until independent, fresh specialist
> Reviewers have tried to break it. The panel is enforced deterministically by
> the committed `.claude/workflows/adversarial-review.mjs` workflow; the
> `review-loop` skill is the one-line entry point.

Every session is an orchestrator by default — `CLAUDE.md` and the `/orchestrate`
skill route here; this doc is the playbook.

---

## Roles

| Role             | Responsibility                                                                         |
| ---------------- | -------------------------------------------------------------------------------------- |
| **Orchestrator** | Decomposes the task, dispatches workers, runs the review panel, makes the final ship call. |
| **Worker**       | Produces an output (code/docs/change) against an explicit spec + acceptance criteria.   |
| **Specialist Reviewer** | A **fresh, adversarial** subagent that tries to break or refute the work through exactly one lens (see the roster). |

Every Reviewer must be a **new subagent each review** — never the worker
reviewing itself, never a reused context. Adversarial independence is the
point; the lens only scopes where it probes.

---

## Tiny-task exception

Orchestration is the default for **all real work**. Direct handling — no
workers, no review panel — is allowed only for: answering questions that change
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
| Most capable available (the session's default model or better) | Writing user-facing copy or docs, specialist review (every lens), anything requiring judgment or ambiguity resolution. |

When unsure, default to inheriting the session model.

---

## The Review Panel

Nine specialist lenses. Four always review; five are routed by the changed-file
list. Routing is deterministic — the workflow applies these globs in code.

| Lens | What to attack | Routing |
| --- | --- | --- |
| **correctness** | Logic bugs, edge cases, wrong assumptions, broken behavior. Test honesty: no skipped/weakened/missing tests; `pnpm preflight` must pass. | Always |
| **security** | Injection, secret exposure, missing authz, unsafe input handling. Trust-model invariants: ADR-007 (transparent evidence, no hidden scoring) and ADR-008 (intake/dedup) must hold. | Always |
| **conventions** | `AGENTS.md` Hard Rules. Reuse/duplication — search `app/components/ui/` (vendored shadcn, ADR-011), `app/components/`, `app/lib/`, `app/server/`, `app/trust/` first. Scope creep. Documentation drift. URL-state hygiene (`docs/agents/url-state.md`). Prose terseness (`docs/agents/writing.md`). | Always |
| **architecture** | The changes as a whole: cross-cutting cohesion, layering (server fns vs Hono per `docs/agents/api.md`, client/server boundaries), consistency with existing patterns — a coherent design, not local patches. | Always |
| **design** | Visual/UX quality per `docs/agents/design.md` + `docs/agents/styling.md`. | `app/components/**`, `app/routes/**/*.tsx`, `*.css`, `components.json` |
| **accessibility** | Semantics, keyboard/focus, contrast, ARIA, screen-reader flow. | Same globs as design |
| **copy** | User-facing copy voice/microcopy per `docs/agents/copy.md` + `writing.md`. | Same globs as design |
| **performance** | Query efficiency, N+1s, loader waterfalls, bundle weight, unnecessary client work. | `app/server/**`, `db/**`, `package.json`, `vite.config.ts` |
| **data** | Schema/migration safety per `docs/agents/database.md`: destructive migrations, missing indexes, schema/migration drift. | `db/**`, `drizzle.config.ts` |

The Orchestrator may **force-add** conditional lenses (the workflow's
`forceSpecialists` arg). Additive only — an always-on lens can never be
removed.

---

## The Loop

1. **Dispatch.** The Orchestrator decomposes the task and sends a **Worker**
   subagent to produce the output, handing it an **explicit spec + acceptance
   criteria**.
2. **Panel review.** The full routed panel reviews **in parallel** — each lens a
   fresh subagent with the adversarial mandate scoped to that lens, returning
   the structured verdict.
3. **Address findings.** If any lens returns `CHANGES_REQUESTED`, the
   Orchestrator sends the **ORIGINAL Worker** back — preserving its context —
   to handle **all findings across the panel**, each either **fixed** or
   **rebutted** with a concrete justification.
4. **Targeted re-check.** A **fresh instance of only each objecting lens**
   re-reviews, given its predecessor's findings plus the worker's per-finding
   responses. Lenses that shipped in step 2 do not re-run.
5. **Stop.** Ship if every lens ships. Anything still contested after the
   re-check is **escalated to the human in the PR description** — never looped
   further.

---

## Verdict Schema

Each specialist returns exactly this structure:

```json
{
  "specialist": "correctness" | "security" | "conventions" | "architecture" | "design" | "accessibility" | "copy" | "performance" | "data",
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
`CONFIRMED` or `PLAUSIBLE` for that lens; otherwise `CHANGES_REQUESTED`.

---

## Stop Condition / Hard Cap

- **Maximum 2 reviews per lens** (panel review + targeted re-check). Do not
  loop further.
- A lens is done as soon as it returns `SHIP`.
- The worker edits **only** when a re-check is guaranteed to follow — no edit
  ships unreviewed. After the re-check there are no further edits.
- After the re-check, any finding still contested (worker rebutted, Reviewer
  unconvinced) is **not** re-litigated. The Orchestrator decides whether to
  ship and **escalates each unresolved item to the human**.

### The PR-body record

Paste the panel record into the PR's `## Adversarial review` section — one line
per lens (conditionals that did not route are `n/a`) plus `overall`:

```md
## Adversarial review
correctness: SHIP
security: SHIP
conventions: SHIP
architecture: SHIP
design: n/a
accessibility: n/a
copy: n/a
performance: SHIP
data: n/a
overall: SHIP
```

The workflow returns these lines verbatim as `recordLines`.

### Escalating unresolved items into the PR body

When shipping with unresolved items after the cap, add this section so the
human reviewer sees exactly what is contested (it replaces or accompanies the
record above):

```md
## Unresolved review items (escalated after review cap)
- **[major] <specialist>/<area>** — <summary>. Worker's rebuttal: <…>. Reviewer's concern: <…>.
- **[minor] <specialist>/<area>** — …
```

Keep it factual: the finding, the worker's rebuttal, and why it stayed
contested. Do not silently drop a `CONFIRMED` blocker — if one remains, do not
ship. (CI also accepts the legacy marker "Unresolved review items (escalated
after 2-round cap)" so in-flight PRs keep passing.)

---

## CI enforcement (the `adversarial-review` gate)

The panel is enforced as a hard PR gate by the `adversarial-review` job in
`.github/workflows/pr-conventions.yml`. (Dependabot PRs are exempt — a bot can't
run the review panel; they remain covered by the `owner-review` gate and
CODEOWNERS, see the job's comment.) To merge, any other PR must satisfy **one** of:

- **`skip-review` label** — bypasses the gate for a trivial or human-only change; **or**
- **both** the **`review:adversarial-passed` label** **and** a well-formed
  **`## Adversarial review`** section in the PR body. That section must contain
  either the panel record above — a `SHIP` token for **each always-on lens**
  (correctness, security, conventions, architecture) **plus** `overall: SHIP` —
  or an escalation marker (`Unresolved review items (escalated after review
  cap)`; the legacy `2-round cap` text also passes). A bare `overall: SHIP`
  with no per-lens lines fails, as does an empty or template-placeholder
  section. The exact rule lives in the header of
  `.github/scripts/check-review-block.mjs` (`validateReviewBlock`). The job
  re-evaluates on `labeled`/`unlabeled`/`edited`, so adding the label or pasting
  the record re-runs it.

**Honest limitation.** CI cannot prove a genuine review occurred — the body block
could be fabricated and the `review:adversarial-passed` label hand-applied. This
gate is a **forcing function plus an auditable record**, not cryptographic proof.
Likewise `skip-review` is a **human judgement call**: CI cannot enforce *who*
applied it or that the change truly warranted skipping. Treat both as social
contracts the gate makes visible, not guarantees.

**Relationship to the owner-review gate.** The review panel is a self/peer
check that any reviewer can clear. It does **not** replace the owner-review
guardrail (`docs/agents/governance.md`): when a change touches an owner-gated
surface (cost / legal / security / trust & safety / destructive data /
privacy / safety-disclaimer), the **security** lens (including its trust-model
invariants) must be probed *and* the PR is `safe:human` — merged by the owner
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
   - `review:adversarial-passed` plus a well-formed panel record (or
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
  `.claude/workflows/adversarial-review.mjs`. The committed workflow routes the
  panel from the changed-file list in code, enforces the per-lens 2-review cap,
  and guarantees **every worker output receives a full panel review in code,
  not by model discretion**. Pass `forceSpecialists` to add conditional lenses.
- **Manual (interactive single task).** For one-off interactive work, run the
  loop yourself via Agent-tool calls, following the numbered loop above: route
  the panel with the roster's globs, spawn a fresh specialist per review, and
  respect the per-lens 2-review cap.
