## TL;DR
<!-- 1–3 plain sentences that anyone in the business can understand: what changed
and why it matters to users or the product. No jargon, no internal codenames, no
file paths — it's OK to sacrifice specificity for clarity. This gets posted to
Slack when the PR merges. See docs/agents/merge-updates.md. -->

-

## Summary
<!-- What does this PR do? Bullet points preferred. -->

-

## Issues resolved
<!-- Link related issues so they auto-close on merge. -->

Resolves #

## Test plan
<!-- How did you verify this works? Checklist of manual or automated steps. -->

- [ ]

## Propagation
<!-- Fill this out if this PR changes anything an existing instance would care about. -->

- [ ] Added a changelog fragment under `changelog.d/` (or applied the `skip-changelog` label if this change needs none — see `changelog.d/README.md`).
- [ ] This PR does **not** bump `package.json` `version`. (If it does, the three items below are required — see `docs/agents/releases.md`.)
- [ ] **OR** this PR bumps the version and includes:
  - [ ] A new `## [X.Y.Z]` section in `CHANGELOG.md` with every bullet tagged `[propagate]`, `[template-only]`, or `[manual]`
  - [ ] A new migration guide at `docs/migrations/vX.Y.md`
  - [ ] The migration guide covers every `[propagate]` CHANGELOG entry

## Notes for reviewer
<!-- Optional: anything the reviewer should know — tradeoffs, open questions, areas of risk. -->

## Adversarial review
<!-- Paste the fresh Reviewer's `overall: SHIP` verdict (or the "Unresolved review
items (escalated after 2-round cap)" block) from the loop in docs/agents/orchestration.md,
then apply the `review:adversarial-passed` label. For a trivial or human-only change,
apply the `skip-review` label instead and leave this empty. -->

-
