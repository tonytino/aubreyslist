# Merge Updates to Slack & the PR TL;DR Convention

> **Decision rule:** every PR body starts with a `## TL;DR` section containing
> 1–3 plain sentences a non-engineer can understand — what changed and why it
> matters to users or the product. On merge to `main` it becomes a Slack update,
> so write it for the business audience, not the reviewer.

## The TL;DR convention

The TL;DR is the top section of `.github/pull_request_template.md` (above
`## Summary`). Rules:

- Plain language. No jargon, codenames, file paths, or function names. Sacrifice
  technical specificity for clarity.
- Say what changed *and* why it matters to users or the product.
- 1–3 short sentences. Needing more suggests the PR does too much.

**Good:**

> People can now save their favorite restaurants and find them again later from
> a new Favorites page.

**Bad (jargon-y — this belongs in `## Summary`, not the TL;DR):**

> Added `favorites` table + Drizzle migration, server fns in
> `app/server/favorites.fn.ts`, and wired `FavoriteButton` into the listing
> detail route with optimistic TanStack Query updates.

### Enforcement

The `pr-tldr` job in `.github/workflows/pr-conventions.yml` fails any PR whose
body lacks a `TL;DR` heading or whose section is empty / still the template
placeholder. Spelling variants `TLDR` / `TL DR` and a trailing `:` are
tolerated; the heading must be the ATX `## TL;DR` form (a setext underline is
not recognized). Detection is code-fence aware, so a `## TL;DR` inside a fenced
example doesn't satisfy the gate. Validator:
`.github/scripts/check-tldr-block.mjs` (zero-dep ESM, unit-tested from
`tests/unit/tldr-block.test.ts`).

**Dependabot is exempt** (`dependabot[bot]` PRs skip the job) — a bot can't
author our template sections. `pr-labels` and `adversarial-review` in the same
workflow carry the identical exemption. `release/*` branches and all other bots
are **in scope** for `pr-tldr`, and there is no skip label. Pre-gate PRs fail on
their next `synchronize`/`edited` event until a TL;DR is added — expected.

## The Slack pipeline

`.github/workflows/slack-merge-updates.yml` fires on `pull_request_target`
`closed` and posts only when the PR actually merged into the default branch. It
runs `.github/scripts/slack-merge-update.mjs`, which builds the message via this
fallback chain (the script logs which source it used):

1. **Claude rewrite** — only when the `ANTHROPIC_API_KEY` secret exists. The PR
   title/TL;DR/body are rewritten for a business audience. Model defaults to
   `claude-sonnet-5`; override with the `SLACK_UPDATE_MODEL` repo Actions
   **variable**. A failed LLM call logs a warning and falls through — the update
   still posts.
2. **TL;DR verbatim** — guaranteed present by the `pr-tldr` gate for
   non-dependabot PRs.
3. **PR title** — always exists; squash-merge makes it the commit message.

## Provisioning (safe:human — repo owner, one time)

Nothing posts until the webhook secret exists; until then the workflow no-ops
**green** with a `::notice::`, so it is safe to merge unprovisioned.

1. Create (or pick) the Slack channel. Recommended: a dedicated
   `#aubreyslist-ships`.
2. Create a Slack incoming webhook for it: <https://api.slack.com/apps> → your
   app (create one if needed) → **Incoming Webhooks** → activate → **Add New
   Webhook to Workspace** → pick the channel → copy the
   `https://hooks.slack.com/services/...` URL.
3. Add it as a repo Actions **secret** named `SLACK_WEBHOOK_URL`
   (Settings → Secrets and variables → Actions). The URL is the credential —
   anyone holding it can post to the channel — so it must be a secret, never a
   variable.
4. *(Optional)* Add an `ANTHROPIC_API_KEY` secret to enable the Claude rewrite.
   Without it, updates post the TL;DR verbatim.

## Security notes

- **Why `pull_request_target`:** secrets must be available even when the merged
  PR came from a fork. Safe here because the workflow never checks out or
  executes PR head code — it checks out the base repo's default branch only to
  read our own committed script.
- **PR body is semi-trusted input:** title/body/author reach the script via env
  vars only (never inline `${{ }}` in `run:`), and the Claude prompt instructs
  the model to treat PR content as material to summarize, ignoring embedded
  instructions.
- **The webhook URL is the secret:** on failure the script logs the HTTP status
  only — never the URL or a response body that could echo it.
