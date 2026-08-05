# Merge Updates to Slack & the PR TL;DR Convention

> **Decision rule:** Every PR body starts with a `## TL;DR` section containing
> 1–3 plain sentences a non-engineer can understand — what changed and why it
> matters to users or the product. Write it before anything else in the body.
> When the PR merges to `main`, that TL;DR becomes a Slack update, so write it
> for the business audience reading the channel, not for the reviewer.

## The TL;DR convention

The TL;DR is the **top section** of `.github/pull_request_template.md` (above
`## Summary`). Rules for a good one:

- Plain language. No jargon, no internal codenames, no file paths, no function
  names. It's OK to sacrifice technical specificity for clarity.
- Say what changed *and* why it matters to users or the product.
- 1–3 short sentences. If you need more, the PR is probably doing too much.

**Good:**

> People can now save their favorite restaurants and find them again later from
> a new Favorites page.

> Searching for restaurants is noticeably faster, especially on phones.

**Bad (jargon-y — don't do this):**

> Added `favorites` table + Drizzle migration, server fns in
> `app/server/favorites.fn.ts`, and wired `FavoriteButton` into the listing
> detail route with optimistic TanStack Query updates.

That "bad" example is a great `## Summary` — it's just not a TL;DR.

### Enforcement

The `pr-tldr` job in `.github/workflows/pr-conventions.yml` fails any PR whose
body is missing a `TL;DR` heading (spelling variants `TLDR` / `TL DR` and a
trailing `:` are tolerated; the heading must be the ATX `## TL;DR` form the
template provides — a setext underline is not recognized) or whose section is
empty / still the template placeholder. Heading detection is code-fence aware,
so a `## TL;DR` inside a fenced example doesn't satisfy the gate. The validator
is `.github/scripts/check-tldr-block.mjs` (zero-dep ESM, unit-tested from
`tests/unit/tldr-block.test.ts`).

**Dependabot is exempt** (`dependabot[bot]` PRs skip the job): it cannot author
our template sections — the same rationale as its `skip-changelog` label for
the changelog gate (see `.github/dependabot.yml`). `pr-labels` and
`adversarial-review` in the same workflow carry the identical Dependabot
exemption, for the same reason — a bot can't run the agent-orchestration steps
those gates check for. Unlike the changelog gate, `release/*` branches and any
other bots are **intentionally in scope** for `pr-tldr`: a release PR can
trivially say what's shipping, and that's exactly the audience the Slack feed
exists for. There is no skip label.
PRs opened before this gate existed will fail on their next
`synchronize`/`edited` event until a TL;DR is added — expected forcing-function
behavior, not a bug.

## The Slack pipeline

`.github/workflows/slack-merge-updates.yml` fires on `pull_request_target`
`closed` and posts only when the PR actually **merged into the default branch**.
It runs `.github/scripts/slack-merge-update.mjs`, which builds the message via
this fallback chain:

1. **Claude rewrite** — only when the `ANTHROPIC_API_KEY` secret exists. The
   PR title/TL;DR/body are sent to the Claude API to be rewritten for a
   business audience. Model defaults to `claude-sonnet-5`; override with the
   `SLACK_UPDATE_MODEL` repo Actions **variable**. A failed LLM call (non-200,
   network error, empty response) degrades gracefully: it logs a warning and
   falls through — the update still posts.
2. **TL;DR verbatim** — the PR's `## TL;DR` section (guaranteed present by the
   `pr-tldr` gate for non-dependabot PRs).
3. **PR title** — always exists; squash-merge makes it the commit message.

The script logs which source it used on every run.

## Provisioning (safe:human — repo owner, one time)

Nothing posts until the webhook secret exists. Until then the workflow no-ops
**green** with a `::notice::`, so this is safe to merge unprovisioned.

1. Create (or pick) the Slack channel. Recommended: a dedicated
   `#aubreyslist-ships` so product updates aren't buried in a busy channel.
2. Create a Slack incoming webhook for it: <https://api.slack.com/apps> → your
   app (create one if needed) → **Incoming Webhooks** → activate → **Add New
   Webhook to Workspace** → pick the channel → copy the
   `https://hooks.slack.com/services/...` URL.
3. Add it as a repo Actions **secret** named `SLACK_WEBHOOK_URL`
   (Settings → Secrets and variables → Actions). The URL is the credential —
   anyone holding it can post to the channel — so it must be a secret, never a
   variable.
4. *(Optional)* Add an `ANTHROPIC_API_KEY` secret to enable the Claude rewrite.
   Without it the feed still works — updates post the TL;DR verbatim.

## Security notes

- **Why `pull_request_target`:** secrets must be available even when the merged
  PR came from a fork (a fork-triggered `pull_request` run gets no secrets).
  It's safe *here* because the workflow never checks out or executes PR head
  code — the checkout is the base repo's default branch, only to read our own
  committed script.
- **PR body is semi-trusted input:** title/body/author reach the script via env
  vars only (never inline `${{ }}` in `run:`, mirroring `pr-conventions.yml`),
  and the Claude prompt explicitly instructs the model to treat the PR content
  as material to summarize and ignore any instructions embedded in it.
- **The webhook URL is the secret:** on failure the script logs the HTTP status
  only — never the URL or a response body that could echo it.
