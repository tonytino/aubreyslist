export const meta = {
  name: 'adversarial-review',
  description:
    'Run each worker output through an independent adversarial review loop (a fresh reviewer every round, hard 2-round cap). Implements docs/agents/orchestration.md deterministically.',
  phases: [
    { title: 'Implement', detail: 'worker produces / revises the change' },
    { title: 'Review', detail: 'fresh adversarial reviewer (max 2 rounds)' },
  ],
}

// ---------------------------------------------------------------------------
// NOTE: this runs inside Claude Code's Workflow runtime, NOT as a standalone
// Node module. The runtime extracts `meta`, injects the globals used below
// (agent/pipeline/parallel/log/args/...), and wraps the body in an async
// function — so top-level `await` and `return` are intentional and valid here.
// `node --check` will (wrongly) flag the top-level `return` as illegal; it is
// not the validity gate for a workflow script. Invoke via the Workflow tool
// (name: "adversarial-review") or the review-loop skill.
// ---------------------------------------------------------------------------
// Input. Pass via the Workflow tool's `args`:
//   { task, context?, acceptance? }            — a single unit of work, or
//   { items: [{ task, context?, acceptance? }] } — a batch (reviewed in parallel)
// A bare string is treated as { task: <string> }.
//
// Each item's worker and reviewers share this run's git working tree, so batch
// items should be INDEPENDENT (touch disjoint files) or the caller should pass
// isolation per item. Reviewers inspect the worker's changes via `git diff`.
// ---------------------------------------------------------------------------
const rawItems = Array.isArray(args?.items) ? args.items : args ? [args] : []
const items = rawItems
  .map((it) => (typeof it === 'string' ? { task: it } : it))
  .filter((it) => it && it.task)

if (!items.length) {
  log('No work items provided. Pass args: { task, context?, acceptance? } or { items: [...] }.')
  return { error: 'no-items' }
}

const MAX_ROUNDS = 2

// Mirrors the verdict schema documented in docs/agents/orchestration.md.
const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'overall', 'notes'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'area', 'summary', 'verdict', 'required_change'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          area: { type: 'string' },
          summary: { type: 'string' },
          verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] },
          required_change: { type: 'string' },
        },
      },
    },
    overall: { type: 'string', enum: ['SHIP', 'CHANGES_REQUESTED'] },
    notes: { type: 'string' },
  },
}

const spec = (item) =>
  [
    `## Task`,
    item.task,
    item.context ? `\n## Context\n${item.context}` : '',
    item.acceptance ? `\n## Acceptance criteria\n${item.acceptance}` : '',
  ]
    .filter(Boolean)
    .join('\n')

const HOUSE_RULES =
  `Honor the repo's conventions: read AGENTS.md (Hard Rules) and the relevant docs/agents/*.md ` +
  `before changing code. No new dependencies without justification, no \`any\`, no \`process.env\` ` +
  `outside app/env.ts, tests for new behavior, and \`pnpm preflight\` must stay green.`

const workerPrompt = (item) =>
  `You are a WORKER subagent. Implement the following in the repo working tree. ` +
  `Make file edits only — do NOT run git/commit/push.\n\n${spec(item)}\n\n${HOUSE_RULES}\n\n` +
  `When done, report a concise summary of exactly what you changed (file paths + the gist), ` +
  `and any assumptions or risks a reviewer should scrutinize.`

const reviewerPrompt = (item, round) =>
  `You are a FRESH, ADVERSARIAL REVIEWER subagent (round ${round} of ${MAX_ROUNDS}). You did NOT ` +
  `write this code. Your mandate is to BREAK or REFUTE the change, not to praise it.\n\n` +
  `Inspect the uncommitted change in the working tree with \`git diff\` (and \`git status\`), then ` +
  `read the surrounding files as needed.\n\n## Original task\n${spec(item)}\n\n` +
  `## Probe every dimension\n` +
  `- Correctness: logic bugs, edge cases, wrong assumptions, broken behavior.\n` +
  `- Security: injection, secret exposure, missing authz, unsafe input.\n` +
  `- Hard Rules: any violation of the Hard Rules in AGENTS.md.\n` +
  `- Trust-model invariants: ADR-007 (transparent evidence, no hidden scoring) and ADR-008 (intake/dedup) must hold.\n` +
  `- Test honesty: no skipped/weakened/missing tests for new code; \`pnpm preflight\` must pass (run it if in doubt).\n` +
  `- Scope creep: unrequested changes, gold-plating, drive-by edits.\n` +
  `- Documentation drift: docs that no longer match the changed behavior.\n\n` +
  `Return the structured verdict. Set overall=SHIP ONLY when no blocker/major finding stands ` +
  `CONFIRMED or PLAUSIBLE; otherwise CHANGES_REQUESTED. Default to skepticism: if a real risk is ` +
  `plausible but unproven, mark it PLAUSIBLE rather than dropping it.`

const addressPrompt = (item, verdict) =>
  `You are the WORKER returning to your change. An adversarial reviewer raised the findings below. ` +
  `For EACH finding: either FIX it in the working tree, or REBUT it with a concrete, specific ` +
  `justification (why it is not a real problem). Make file edits only — no git.\n\n` +
  `## Original task\n${spec(item)}\n\n## Reviewer findings\n` +
  '```json\n' +
  JSON.stringify(verdict.findings, null, 2) +
  '\n```\n\n' +
  `Reviewer notes: ${verdict.notes}\n\n` +
  `Report, per finding, whether you FIXED (what you changed) or REBUTTED (why), and confirm ` +
  `\`pnpm preflight\` still passes.`

// One worker pass, then up to MAX_ROUNDS adversarial reviews. Between rounds the
// worker addresses each CHANGES_REQUESTED verdict (fix or rebut) and the NEXT
// round reviews the result — so every worker edit is seen by a reviewer. After
// the final round there is no further editing: anything still contested is
// escalated to the human (we never ship unreviewed worker output). pipeline()
// runs items independently with no barrier between stages.
const results = await pipeline(
  items,
  (item, _orig, i) => agent(workerPrompt(item), { label: `worker:${i}`, phase: 'Implement' }),
  async (firstOutput, item, i) => {
    let output = firstOutput
    let lastVerdict = null
    let rounds = 0
    const history = []

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      rounds = round
      const verdict = await agent(reviewerPrompt(item, round), {
        label: `review:${i}:r${round}`,
        phase: 'Review',
        schema: VERDICT_SCHEMA,
      })
      lastVerdict = verdict
      history.push({ round, verdict })
      if (!verdict || verdict.overall === 'SHIP') break

      // Only let the worker edit when ANOTHER review round will follow. We never
      // ship worker edits that no reviewer has seen, so after the final round we
      // skip straight to escalation instead of making unreviewed changes.
      if (round < MAX_ROUNDS) {
        output = await agent(addressPrompt(item, verdict), {
          label: `address:${i}:r${round}`,
          phase: 'Implement',
        })
      }
    }

    const shipped = lastVerdict?.overall === 'SHIP'
    // After the cap, surface anything still standing for the human / PR body.
    const unresolved =
      shipped || !lastVerdict
        ? []
        : lastVerdict.findings.filter((f) => f.verdict !== 'REFUTED')

    if (!shipped && unresolved.length) {
      log(
        `Item ${i} hit the ${MAX_ROUNDS}-round cap with ${unresolved.length} unresolved finding(s) — escalate in the PR body.`,
      )
    }

    return { task: item.task, output, rounds, shipped, lastVerdict, unresolved, history }
  },
)

return results.filter(Boolean)
