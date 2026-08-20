export const meta = {
  name: 'adversarial-review',
  description:
    'Run each worker output through the specialist review panel: routed adversarial reviewers in parallel, one worker address pass, targeted re-check, hard 2-review cap per lens. Implements docs/agents/orchestration.md deterministically.',
  phases: [
    { title: 'Implement', detail: 'worker produces / revises the change' },
    { title: 'Panel review', detail: 'routed specialist reviewers, in parallel' },
    { title: 'Re-check', detail: 'fresh instances of the objecting specialists only' },
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
// Optional: { forceSpecialists: string[] } — conditional lenses to add to every
// item's panel regardless of routing. Additive only: always-on lenses can never
// be removed, and unknown keys are ignored with a log line.
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

// Hard cap: each lens reviews at most twice (round 1 + one targeted re-check).
const MAX_REVIEWS_PER_LENS = 2

// The specialist roster (docs/agents/orchestration.md → The Review Panel).
// Always-on lenses review every item; conditional lenses are routed by the
// changed-file globs below (or force-added via args.forceSpecialists).
const ALWAYS_ON = ['correctness', 'security', 'conventions', 'architecture']
const CONDITIONAL = ['design', 'accessibility', 'copy', 'performance', 'data']
const ALL_LENSES = ALWAYS_ON.concat(CONDITIONAL)

// What each lens attacks. Every reviewer keeps the adversarial mandate; the
// lens only scopes WHERE it probes.
const LENS_FOCUS = {
  correctness: [
    'Logic bugs, edge cases, wrong assumptions, broken behavior.',
    'Test honesty: no skipped, weakened, or missing tests for new code; `pnpm preflight` must pass (run it if in doubt).',
  ],
  security: [
    'Injection, secret exposure, missing authz, unsafe input handling.',
    'Trust-model invariants: ADR-007 (transparent evidence, no hidden scoring) and ADR-008 (intake/dedup) must hold.',
  ],
  conventions: [
    'Hard Rules: any violation of the Hard Rules in AGENTS.md.',
    'Reuse / duplication: search app/components/ui/ (vendored shadcn, ADR-011), app/components/, app/lib/, app/server/, app/trust/ before accepting new code. A re-implementation with different names is still a duplicate.',
    'Scope creep: unrequested changes, gold-plating, drive-by edits outside the spec.',
    'Documentation drift: docs that no longer match the changed behavior.',
    'URL-state hygiene: shareable UI state kept in useState instead of the URL; defaults leaking into the querystring; a client-only param wrongly in loaderDeps or a server param not resetting page (docs/agents/url-state.md).',
    'Prose terseness: history narration, ticket IDs in comments, comments restating the code, bloated docs or PR bodies (docs/agents/writing.md).',
  ],
  architecture: [
    'How the changes come together as a whole: cross-cutting cohesion, not file-local nits.',
    'Layering: server functions vs Hono per docs/agents/api.md; client/server boundaries.',
    'Consistency with existing patterns; whether the diff forms a coherent design rather than local patches.',
  ],
  design: [
    'Visual/UX quality: hierarchy, spacing, states, responsiveness per docs/agents/design.md and docs/agents/styling.md.',
  ],
  accessibility: [
    'Semantics, keyboard/focus order, contrast, ARIA correctness, screen-reader flow.',
  ],
  copy: [
    'User-facing copy: voice, microcopy, clarity per docs/agents/copy.md and docs/agents/writing.md.',
  ],
  performance: [
    'Query efficiency and N+1s, loader waterfalls, bundle weight, unnecessary client work.',
  ],
  data: [
    'Schema/migration safety per docs/agents/database.md: destructive migrations, missing indexes, schema/migration drift.',
  ],
}

// Deterministic routing: conditional lenses run only when the changed-file
// list matches their globs. Mirrors the roster table in orchestration.md.
const UI_GLOBS = [/^app\/components\//, /^app\/routes\/.*\.tsx$/, /\.css$/, /^components\.json$/]
const ROUTING = {
  design: UI_GLOBS,
  accessibility: UI_GLOBS,
  copy: UI_GLOBS,
  performance: [/^app\/server\//, /^db\//, /^package\.json$/, /^vite\.config\.ts$/],
  data: [/^db\//, /^drizzle\.config\.ts$/],
}

// forceSpecialists is additive-only and limited to conditional lenses —
// always-on lenses can never be removed, so there is nothing to validate there.
const forcedRaw = Array.isArray(args?.forceSpecialists) ? args.forceSpecialists : []
const forced = forcedRaw.filter((k) => CONDITIONAL.includes(k))
const forcedInvalid = forcedRaw.filter((k) => !CONDITIONAL.includes(k))
if (forcedInvalid.length) {
  log(
    `Ignoring unknown forceSpecialists: ${forcedInvalid.join(', ')}. Valid keys: ${CONDITIONAL.join(', ')}.`,
  )
}

// Mirrors the verdict schema documented in docs/agents/orchestration.md.
// `specialist` names the lens the verdict speaks for.
const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['specialist', 'findings', 'overall', 'notes'],
  properties: {
    specialist: { type: 'string', enum: ALL_LENSES },
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

const FILES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files'],
  properties: { files: { type: 'array', items: { type: 'string' } } },
}

const FILES_PROMPT =
  'List every file the git working tree changes relative to HEAD. Run ' +
  '`git diff --name-only HEAD` and `git status --porcelain` (the latter catches untracked ' +
  'files). Return { files: [...] } with repo-relative paths, deduplicated. Report paths only — ' +
  'do not read or judge the changes.'

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
  `outside app/env.ts, tests for new behavior, and \`pnpm preflight\` must stay green. All prose ` +
  `(comments, docs, PR bodies) follows docs/agents/writing.md.`

const workerPrompt = (item) =>
  `You are a WORKER subagent. Implement the following in the repo working tree. ` +
  `Make file edits only — do NOT run git/commit/push.\n\n${spec(item)}\n\n${HOUSE_RULES}\n\n` +
  `When done, report a concise summary of exactly what you changed (file paths + the gist), ` +
  `and any assumptions or risks a reviewer should scrutinize.`

const specialistPrompt = (item, key, review, prior, workerResponse) =>
  [
    `You are a FRESH, ADVERSARIAL SPECIALIST REVIEWER subagent for the \`${key}\` lens ` +
      `(review ${review} of at most ${MAX_REVIEWS_PER_LENS} for this lens). You did NOT write ` +
      `this change. Your mandate is to BREAK or REFUTE it — but ONLY through your lens. Other ` +
      `lenses have their own reviewers; do not report findings outside yours.`,
    `Inspect the uncommitted change in the working tree with \`git diff\` (and \`git status\`), ` +
      `then read the surrounding files and docs as needed.`,
    `## Original task\n${spec(item)}`,
    `## Your lens: ${key}\n${LENS_FOCUS[key].map((f) => `- ${f}`).join('\n')}`,
    prior
      ? `## Predecessor findings (your lens, previous review)\n` +
        '```json\n' +
        JSON.stringify(prior.findings, null, 2) +
        '\n```\n' +
        `Predecessor notes: ${prior.notes}\n\n` +
        `## Worker's per-finding responses\n${workerResponse}\n\n` +
        `Judge each predecessor finding: fixed, adequately rebutted, or still standing. ` +
        `Report NEW findings only if your lens exposes them in the revised diff.`
      : '',
    `Return the structured verdict with \`specialist\` set to "${key}". Set overall=SHIP ONLY ` +
      `when no blocker/major finding stands CONFIRMED or PLAUSIBLE for this lens; otherwise ` +
      `CHANGES_REQUESTED. Default to skepticism: if a real risk is plausible but unproven, mark ` +
      `it PLAUSIBLE rather than dropping it.`,
  ]
    .filter(Boolean)
    .join('\n\n')

const addressPrompt = (item, objections) =>
  `You are the WORKER returning to your change. The specialist review panel raised the findings ` +
  `below, grouped by lens. For EACH finding: either FIX it in the working tree, or REBUT it with ` +
  `a concrete, specific justification (why it is not a real problem). Make file edits only — no ` +
  `git.\n\n## Original task\n${spec(item)}\n\n` +
  objections
    .map(
      (o) =>
        `## Findings from the \`${o.key}\` specialist\n` +
        '```json\n' +
        JSON.stringify(o.verdict.findings, null, 2) +
        '\n```\n' +
        `Reviewer notes: ${o.verdict.notes}`,
    )
    .join('\n\n') +
  `\n\nReport, per finding (grouped by lens), whether you FIXED (what you changed) or REBUTTED ` +
  `(why), and confirm \`pnpm preflight\` still passes.`

// One worker pass, then the panel. Loop shape per orchestration.md:
//   1. routed panel reviews in parallel (parallel() is the barrier — the worker
//      must not edit until every lens has reported);
//   2. if any lens objects, the ORIGINAL worker addresses ALL findings across
//      the panel (fix or rebut each);
//   3. targeted re-check: a fresh instance of ONLY each objecting lens, given
//      its predecessor's findings plus the worker's responses.
// The worker edits ONLY between steps 1 and 3, when the re-check is guaranteed
// to follow — no worker edit ever ships unreviewed. After the re-check there
// are no further edits, only escalation. pipeline() runs items independently.
const results = await pipeline(
  items,
  (item, _orig, i) => agent(workerPrompt(item), { label: `worker:${i}`, phase: 'Implement' }),
  async (firstOutput, item, i) => {
    let output = firstOutput

    // One cheap agent call fetches the changed-file list; routing itself is
    // pure JS over that list, so the panel composition is deterministic.
    const fileResult = await agent(FILES_PROMPT, {
      label: `files:${i}`,
      phase: 'Panel review',
      schema: FILES_SCHEMA,
      effort: 'low',
    })
    const files = Array.isArray(fileResult?.files) ? fileResult.files : []

    const routed = CONDITIONAL.filter(
      (key) => forced.includes(key) || files.some((f) => ROUTING[key].some((re) => re.test(f))),
    )
    const panel = ALWAYS_ON.concat(routed)
    log(`Item ${i} panel: ${panel.join(', ')} (files matched: ${files.length}).`)

    const state = {}
    for (const key of ALL_LENSES) state[key] = { ran: false, rounds: 0, lastVerdict: null }

    // Round 1: the full routed panel, in parallel. The barrier matters — every
    // lens must report before the worker touches the tree again.
    const round1 = await parallel(
      panel.map((key) => () =>
        agent(specialistPrompt(item, key, 1, null, null), {
          label: `review:${i}:${key}:r1`,
          phase: 'Panel review',
          schema: VERDICT_SCHEMA,
        }),
      ),
    )
    panel.forEach((key, idx) => {
      state[key] = { ran: true, rounds: 1, lastVerdict: round1[idx] ?? null }
    })

    const objectors = panel.filter(
      (key) => state[key].lastVerdict?.overall === 'CHANGES_REQUESTED',
    )

    if (objectors.length) {
      // The ONLY worker-edit point after round 1: the targeted re-check below
      // always follows, so these edits never ship unreviewed.
      output = await agent(
        addressPrompt(
          item,
          objectors.map((key) => ({ key, verdict: state[key].lastVerdict })),
        ),
        { label: `address:${i}`, phase: 'Implement' },
      )

      // Targeted re-check: fresh instances of ONLY the objecting lenses.
      // Second (and final) review for each — MAX_REVIEWS_PER_LENS is 2.
      const recheck = await parallel(
        objectors.map((key) => () =>
          agent(specialistPrompt(item, key, 2, state[key].lastVerdict, output), {
            label: `review:${i}:${key}:r2`,
            phase: 'Re-check',
            schema: VERDICT_SCHEMA,
          }),
        ),
      )
      objectors.forEach((key, idx) => {
        state[key] = { ran: true, rounds: 2, lastVerdict: recheck[idx] ?? state[key].lastVerdict }
      })
    }

    const overall = panel.every((key) => state[key].lastVerdict?.overall === 'SHIP')
      ? 'SHIP'
      : 'CHANGES_REQUESTED'

    // After the cap, surface anything still standing for the human / PR body.
    const unresolved = []
    for (const key of panel) {
      const v = state[key].lastVerdict
      if (!v || v.overall === 'SHIP') continue
      for (const f of v.findings) {
        if (f.verdict !== 'REFUTED') unresolved.push({ specialist: key, ...f })
      }
    }

    if (overall !== 'SHIP') {
      const contested = panel.filter((key) => state[key].lastVerdict?.overall !== 'SHIP')
      log(
        `Item ${i}: lens(es) still contested after the per-lens cap — ${contested.join(', ')}. ` +
          `Escalate under 'Unresolved review items (escalated after review cap)' in the PR body.`,
      )
    }

    // Exact PR-body record lines (validated by .github/scripts/check-review-block.mjs).
    const recordLines = ALL_LENSES.map((key) =>
      state[key].ran
        ? `${key}: ${state[key].lastVerdict?.overall === 'SHIP' ? 'SHIP' : 'CHANGES_REQUESTED'}`
        : `${key}: n/a`,
    ).concat([`overall: ${overall}`])

    return {
      task: item.task,
      output,
      specialists: state,
      overall,
      unresolved,
      recordLines,
    }
  },
)

return results.filter(Boolean)
