# Owner-Review Guardrails

**Read this before opening any PR.** It defines the small set of changes that
require the repo owner's (**@tonytino**) explicit review — and confirms that
everything else ships without him. The goal: contributors and the agents they
drive deliver **most** work autonomously, and the owner is pulled in **only** for
high-caliber changes.

> One-line rule: **if your PR touches an owner-gated surface (below), label it
> `safe:human` and let @tonytino review + merge it. Otherwise label it
> `safe:agent` and ship it on green CI.** Agents never merge a `safe:human` PR.

---

## The seven owner-gated categories

A change requires the owner's explicit review when it touches any of:

1. **Cost** — billed Google Places/Maps API, Neon, Vercel, or Sentry volume.
2. **Legal** — license, PII handling, terms/privacy, third-party ToS.
3. **Security** — auth, session, middleware chokepoints, secrets, privilege/RBAC.
4. **Trust & safety model** — the community-trust invariants (ADR-007/008/010):
   attestations, incidents, moderation, flags, trust scoring. On a celiac-safety
   product a corrupted safety signal can cause real-world harm — owner-caliber.
5. **Destructive / irreversible data changes** — data-loss migrations against real
   user + health-incident data.
6. **Data-collection / privacy posture** — new tracking, new PII capture, or new
   outbound data to third parties.
7. **Safety / medical-disclaimer copy** — the "not medical advice" framing and any
   health-safety claims.

The exact files are enumerated in **`.github/scripts/owner-review-paths.mjs`**
(`OWNED_PATHS` + `CONTENT_CHECKS`) — the single source of truth — and mirrored in
**`.github/CODEOWNERS`**. A test (`tests/unit/check-owner-review.test.ts`) fails
the build if those two ever drift apart.

---

## How enforcement works — two layers

**Layer 1 — CODEOWNERS + branch protection (the teeth).** `.github/CODEOWNERS`
assigns exactly the gated paths to @tonytino; everything else is unowned. With
branch protection set to **Require review from Code Owners** (see the owner
checklist below), an owned-path PR **cannot be merged** — GitHub blocks the merge
(a direct API merge returns `405`; auto-merge just waits) until @tonytino's own
account approves. No collaborator, bot, admin, or agent can satisfy or dismiss
that review. This is the unbypassable, identity-bound gate.

**Layer 2 — the `owner-review` CI job (the tripwire).** `.github/scripts/check-owner-review.mjs`
(run by the `owner-review` job in `.github/workflows/pr-conventions.yml`) scans
each PR's changed files against the same path policy **plus** content signals that
paths can't see — destructive SQL in a migration, the safety disclaimer wherever
it lives, telemetry/PII posture. If a gated surface is touched but the PR isn't
labeled `safe:human`, **CI fails** with a "relabel `safe:human`" message. This
stops an agent self-labeling a gated change `safe:agent` (auto-mergeable) and
gives fast feedback. Layer 1 backstops every miss, so this stays simple.

**There is no bypass label.** Unlike the adversarial-review gate (`skip-review`),
the owner-review gate cannot be waved off by a label — a label is appliable by any
write collaborator or bot, which would defeat the point. The only way past a gated
change is @tonytino's own review + merge.

### Known limitations (honest)

The backstop is **asymmetric**, and it matters:

- **Path categories are hard-backstopped.** For anything living in an owned path
  (auth, places, schema, migrations, env, the config surface, …), Layer 1 blocks
  the merge regardless of label — even if the Layer-2 detector had a bug.
- **Content categories are best-effort.** The disclaimer, telemetry, and
  destructive-SQL checks exist to catch gated changes that land in **unowned**
  files (a disclaimer reworded into a new component; a brand-new analytics init).
  Those have **no Layer-1 backstop by construction** — so a content-category
  change that evades the regex heuristics can still merge as `safe:agent`. The
  patterns are kept deliberately broad, but they are heuristics, not a proof.
  Destructive SQL run from **non-migration** app code (a raw `sql`…`` outside
  `db/migrations/`) is likewise not caught by the migration check.
- **Mitigation:** when you add a new outbound tracker, a new user-facing safety
  claim, or raw destructive SQL, classify honestly as `safe:human` even if CI is
  green — the gate is a floor, not a ceiling. Reviewers: treat the **Trust-model
  invariants**, **Security**, and data-collection dimensions of the
  adversarial-review loop as the human backstop for these content categories.
- **Credentials, not code, are the ultimate boundary.** No GitHub setting can tell
  the owner apart from an agent holding the owner's approve-capable token — see the
  merge norm below.

---

## The merge norm (hard rule)

Agents must **never take an action-as-a-human that the human would disapprove of.**
Concretely:

- **A human always clicks merge on a `safe:human` / owner-gated PR.** Agents never
  merge, and never enable auto-merge, on these.
- Agents may still self-merge `safe:agent` PRs once CI is green.
- No GitHub setting can distinguish the owner from an agent holding the owner's
  credentials, so this is a norm the owner upholds operationally: agents run under
  an identity that is **not** a code owner and **not** admin, and the owner's
  approve-capable credentials are never handed to an agent.

---

## What to do as a contributor / agent

1. Before opening a PR, check whether your diff touches any gated surface above.
   When in doubt, run it locally:
   ```bash
   BASE_SHA=origin/main OWNER_REVIEW_LABELS=safe:agent \
     node .github/scripts/check-owner-review.mjs
   ```
2. If it fails (gated surface touched), apply **`safe:human`** (not `safe:agent`),
   fill in the "Owner sign-off" block in the PR template, and hand off — implement
   the change, but let @tonytino review and merge it. A `safe:human` label is not
   a stop signal for the *work*, only for the *merge* (see `docs/agents/tasks.md`).
3. If it passes, label `safe:agent` and proceed as normal.

The reviewer's adversarial-review loop (`docs/agents/orchestration.md`) already
probes **Trust-model invariants** and **Security** as review dimensions — the
owner-review gate is the merge-time backstop that makes those the owner's call,
not a self-review's.

---

## Owner-only setup checklist (@tonytino)

The teeth live in repo Settings, which only you can configure. Do this once
(prefer a **Ruleset** over classic branch protection — it's API-exportable and
auditable):

**Branch protection / Ruleset on `main`:**
1. **Require a pull request before merging** + **Require review from Code Owners**.
2. **Required approvals = 0.** Do *not* set a global ≥1 — that would force review on
   the *unowned* PRs you want agent-driven. The code-owner requirement fires
   independently, only on owned-path PRs.
3. **Dismiss stale approvals when new commits are pushed** — *non-negotiable*.
   Without it, a helper gets you to approve commit A then pushes the real change as
   commit B and merges on the stale approval.
4. **Do not allow bypassing the above settings**; keep the **bypass list empty**
   (including GitHub Apps).
5. **Restrict who can dismiss reviews**; **block force-push and branch deletion**
   on `main`; **require conversation resolution**; require your status checks —
   including the new **`owner-review`** job and **CodeQL** — to pass.
6. Add helpers as **write** collaborators — **never admin**.

**Identity & backstops:**
- Agents you run authenticate as a **non-owner, non-admin** identity; your
  personal approve-capable credentials never go to an agent (see the merge norm).
- **Out-of-band budget caps** are the real backstop for cost that path-ownership
  can't see (e.g. a client loop that fans out API calls): Google Cloud **Places
  quota + budget alert**, Neon and Vercel spend alerts. This is the scope of
  Linear **AUB-49**.

**If you ever change the gate:** editing `.github/CODEOWNERS`,
`.github/scripts/owner-review-paths.mjs`, or any workflow/config is itself
owner-gated (via `/.github/` and the config surface in CODEOWNERS), so loosening
the guardrail requires your own review. Keep `owner-review-paths.mjs` and
`CODEOWNERS` in sync — the drift test enforces it.
