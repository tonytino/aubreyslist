# PR Visuals

Every PR needs a passing `pr-visuals-check`. Decide the UI impact from the diff:

- **No visible change** (tests, CI, docs, server code with identical output): apply
  `visuals:none`. Done.
- **Visible change:** write a scenarios block in the PR body, then apply `visuals:generate`.
  CI captures before/after screenshots and writes them into the PR body.

To apply a label: `gh pr edit <number> --add-label <label>` (or the GitHub MCP).

Only the CI job's result comment passes the check. A visuals block you write or paste into
the body does not.

The tool is `pr-visuals` from `tonytino/agent-kit`. Its agent skill covers the full flow:
[`SKILL.md`](https://github.com/tonytino/agent-kit/blob/main/pr-visuals/skills/pr-visuals/SKILL.md).

## Labels

| Label | Description |
| --- | --- |
| `visuals:none` | No UI impact. The pr-visuals check passes. |
| `visuals:generate` | Capture before/after visuals into the PR body. The job removes this label. |
| `visuals:still-valid` | The visuals still match this commit. Use after changes that do not affect the UI. The job removes this label. |

## Scenarios block

An HTML comment in the PR body. Keep exactly one. List only the pages and flows the PR
changes, one scenario per distinct change. Never capture the whole app.

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

## Read the result

Watch the run (`gh run watch`), then read the job comment (`gh pr view <number> --comments`).

- Invalid block: the comment names the reason. Fix the block and apply `visuals:generate`.
- After-side `capture failed`: fails the check. Fix the steps or path and apply
  `visuals:generate`.
- Before-side `Not present before this PR`: expected for new pages and UI. Does not fail the
  check.
- No successful Preview deployment: `generate` times out after 15 minutes. Fix the deploy
  first, then apply `visuals:generate`.
- The label stays on and no comment appears: remove the label, then add it again.

## After new commits

The check fails as stale when the latest capture is for an older commit.

- The new commits change the UI: apply `visuals:generate` to recapture.
- They do not (review fixes in tests, docs, server code): apply `visuals:still-valid`. It does
  not pass a capture with failed after-side cells.

## How it runs

- Config: `.github/pr-visuals.json`, read from the PR base branch only. A config change takes
  effect after it merges.
- Before is production (`https://www.aubreys-list.com`). After is the Vercel `Preview`
  deployment for the head commit, awaited up to 15 minutes.
- Workflow: `.github/workflows/pr-visuals.yml`. Images go to the orphan branch `pr-visuals`.
  Do not delete it. agent-kit writes a `vercel.json` there that turns off Vercel deployments
  of that branch.
- Captures show what the pages render. Do not capture pages with secrets or personal data.
- Dependabot PRs skip the check.
- Fork PRs cannot generate. A maintainer pushes the branch to this repo and opens a new PR.

## Setup facts

- Repo secret `PR_VISUALS_HEADERS` holds the Vercel Protection Bypass for Automation headers:
  `{"x-vercel-protection-bypass":"<secret>","x-vercel-set-bypass-cookie":"true"}`. Previews are
  SSO-protected, so `generate` cannot reach them without it.
- `scripts/labels.mjs` defines the `visuals:*` labels.
- `pr-visuals-check` is a required status on `main`.
