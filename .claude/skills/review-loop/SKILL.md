---
name: review-loop
description: Run the specialist review panel on a worker subagent's output when orchestrating multi-agent work. Use whenever you are the orchestrator dispatching workers and must independently review their output (code/docs/change) before shipping it.
---

# Specialist Review Panel

You are orchestrating multi-agent work. Every worker output gets an independent
specialist review panel before it ships. Cap at **2 reviews per lens**.

## Checklist

1. **Read the playbook.** Open `docs/agents/orchestration.md` for the roster
   (9 lenses, routing rules), loop shape, verdict schema, PR-body record, and
   escalation rules. It is the source of truth; this skill only routes you.
2. **Pick the execution path:**
   - **Batch work →** delegate the deterministic fan-out to the
     `.claude/workflows/adversarial-review.mjs` workflow. It routes the panel
     from the changed-file list in code, enforces the per-lens 2-review cap,
     and guarantees every worker output gets a full panel review in code, not
     by model discretion. Pass `forceSpecialists` to add conditional lenses
     (additive only). Prefer this whenever there is more than one output.
   - **Single interactive task →** run the loop manually via Agent-tool calls,
     following the numbered loop in the playbook.
3. **Run the loop (manual path):** dispatch the Worker with an explicit spec +
   acceptance criteria → route the panel from the changed-file list (a
   prose-only diff routes conventions + copy; every other diff routes the 4
   always-on lenses — correctness, security, conventions, architecture — plus
   each conditional lens whose globs match) → spawn a **fresh** specialist per
   lens, in parallel → on any `CHANGES_REQUESTED`, send the **original** Worker
   back to fix or rebut every finding across the panel → re-check with a fresh
   instance of **only each objecting lens**, given the prior findings and the
   worker's responses.
4. **Stop at the cap.** A lens is done on `SHIP`. After its **second review**,
   do not loop further — the orchestrator decides and **escalates unresolved
   items to the human in the PR description** (marker heading in the playbook).

## Specialist verdict schema

```json
{
  "specialist": "correctness"|"security"|"conventions"|"architecture"|"design"|"accessibility"|"copy"|"performance"|"data",
  "findings": [
    { "severity": "blocker"|"major"|"minor", "area": "...", "summary": "...", "verdict": "CONFIRMED"|"PLAUSIBLE"|"REFUTED", "required_change": "..." }
  ],
  "overall": "SHIP"|"CHANGES_REQUESTED",
  "notes": "..."
}
```

Each specialist is a **fresh subagent** with an adversarial mandate (try to
break the work) scoped to its lens; `overall` is `SHIP` only when no
blocker/major finding stands CONFIRMED or PLAUSIBLE for that lens. Paste the
resulting panel record (per-lens lines + `overall`, `n/a` for unrouted lenses)
into the PR's `## Adversarial review` section. Every routed lens needs a
verdict there — a missing line, or `n/a` on a routed lens, fails CI.
