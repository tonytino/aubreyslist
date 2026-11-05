# PR Visuals

Every PR needs a passing `pr-visuals / check`. Decide the UI impact from the diff:

- **No visible change** (tests, CI, docs, server code with identical output): apply
  `visuals:none`. Done.
- **Visible change:** write a scenarios block in the PR body, then apply `visuals:generate`.
  CI captures before/after screenshots and writes them into the PR body.

To apply a label: `gh pr edit <number> --add-label <label>` (or the GitHub MCP).

The tool is `pr-visuals` from `tonytino/agent-kit`. Its agent skill covers the full flow,
including the local capture path:
[`SKILL.md`](https://github.com/tonytino/agent-kit/blob/main/pr-visuals/skills/pr-visuals/SKILL.md).

## Labels

| Label | Description |
| --- | --- |
| `visuals:none` | No UI impact. The pr-visuals check passes. |
| `visuals:generate` | Capture before/after visuals into the PR body. Removed after the run starts. |
| `visuals:still-valid` | The visuals still match this commit. Use after changes that do not affect the UI. |

`scripts/labels.mjs` defines them.

## Scenarios block

An HTML comment in the PR body. Keep exactly one. List only the pages and flows the PR
changes, one scenario per distinct change.

```
<!-- pr-visuals:scenarios
{ "scenarios": [
  { "name": "Directory filters", "path": "/?sort=near", "viewports": ["desktop", "mobile"],
    "steps": [ { "click": "role=button[name=\"Filters\"]" }, { "waitFor": "text=Results" } ] }
] }
-->
```

- `path` and `goto` are relative and start with `/`.
- Viewports: `desktop` (1280x800) and `mobile` (390x844). Default: both.
- Steps: `goto`, `click`, `fill`, `press`, `hover`, `waitFor`, `wait`, `scroll`. Prefer role
  and text selectors. Prefer `waitFor` over `wait`.
- Add `"video": true` only when motion or a multi-step flow is the change.

Full format and limits:
[`references/scenarios.md`](https://github.com/tonytino/agent-kit/blob/main/pr-visuals/skills/pr-visuals/references/scenarios.md).
An invalid block fails `generate` with a PR comment. Fix it and apply `visuals:generate` again.

## After new commits

The check fails as stale when the head commit has no visuals.

- The new commits change the UI: apply `visuals:generate` to recapture.
- They do not (review fixes in tests, docs, server code): apply `visuals:still-valid`.

## How it runs

- Config: `.github/pr-visuals.json`. Before is production (`https://www.aubreys-list.com`).
  After is the Vercel `Preview` deployment for the head commit, awaited up to 15 minutes.
- Workflow: `.github/workflows/pr-visuals.yml`. Images go to the orphan branch `pr-visuals`.
  Do not delete it.
- Dependabot PRs skip the check.
- Fork PRs cannot generate. Capture locally per the skill and paste the block.

## Owner setup (@tonytino)

1. Create the repo secret `PR_VISUALS_HEADERS`. Value, using the Vercel Protection Bypass for
   Automation secret:
   `{"x-vercel-protection-bypass":"<secret>","x-vercel-set-bypass-cookie":"true"}`.
   Previews are SSO-protected, so `generate` cannot reach them without it.
2. Create the labels: `node scripts/labels.mjs`.
3. In the `main` ruleset, require the status check `check` from the `pr-visuals` workflow
   (shown as `pr-visuals / check`).
