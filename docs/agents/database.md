# Database

Stack: Drizzle ORM + Neon (serverless Postgres).

## Key Files

| File                  | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `db/schema.ts`        | Single source of truth for all table definitions     |
| `db/client.ts`        | Drizzle + Neon client — call `getDb()` from here     |
| `db/migrations/`      | Auto-generated migration files — never edit manually |
| `drizzle.config.ts`   | Drizzle Kit config                                   |

## Adding or Changing a Table

1. Edit `db/schema.ts`
2. Run `pnpm db:generate` — creates a migration file in `db/migrations/`
3. Run `pnpm db:migrate` — applies it to the database
4. Export inferred types from `db/schema.ts` for use in the app

```ts
// db/schema.ts
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const posts = pgTable("posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
```

## Querying

```ts
import { getDb } from "~/db/client";
import { posts } from "~/db/schema";

const db = getDb(); // lazily constructed + memoized; needs DATABASE_URL

// Select
const all = await db.select().from(posts);

// Insert
await db.insert(posts).values({ id: "1", title: "Hello" });

// Delete
await db.delete(posts).where(eq(posts.id, "1"));
```

## Rules

- `db` is **server-only**. Never import it in components, hooks, or any file
  that runs in the browser.
- **Never create or alter tables directly in the database** (e.g. the Neon SQL
  editor). All schema changes go through `db/schema.ts` + `pnpm db:generate` /
  `pnpm db:migrate`. Hand-written DDL causes drift between the DB and
  migrations.
- Never edit files in `db/migrations/` manually.
- **Never renumber or re-timestamp a migration that any long-lived database may
  have already applied** — see the section below. Regenerate a fresh migration
  instead.
- Always export `$inferSelect` and `$inferInsert` types alongside new tables.
- Use `pnpm db:studio` to inspect the database visually during development.

## Never renumber an applied migration (`pnpm db:verify`, AUB-195)

**Decision rule: once a migration may have been applied to ANY long-lived
database — the persistent CI Neon branch, a PR's preview branch, or prod —
never rename, renumber, or re-timestamp it. If its DDL needs to reach a
database that missed it, run `pnpm db:generate` and ship a FRESH migration.**

Why: drizzle's migrator (CLI and the programmatic `migrate()` the integration
tests call — one shared core) applies only the journal entries whose `when`
timestamp is **strictly greater** than the last applied row's timestamp in
`drizzle.__drizzle_migrations`. It does not check entries individually. If a
journal edit leaves an unapplied entry with a `when` ≤ some already-applied
timestamp, that migration is **silently skipped forever** — and
`pnpm db:migrate` still exits 0. On one database a renumbered migration reads
as applied; on another (preview, prod) the same edit silently skips genuinely
new DDL and the app breaks at runtime.

The guard: **`pnpm db:verify`** (`scripts/verify-migrations.ts`) checks that
every entry in `db/migrations/meta/_journal.json` has a matching applied row in
`drizzle.__drizzle_migrations` (matched by the same sha256-of-file-content hash
the migrator records; rows are claimed 1:1) and exits non-zero naming each
missing tag. Divergence handling:

- **Extra applied rows** (renamed-away history a DB already ran): info only.
- **DRIFTED, allowlisted**: a hash mismatch whose entry claims an applied row
  at its exact recorded `when` means the DB ran a since-edited version of that
  journal slot. Benign drift is structurally indistinguishable from a
  renumbered-and-edited migration whose new SQL never ran — so drift is
  tolerated (warning) **only** for tags a human has verified and listed in
  `KNOWN_DRIFTED_TAGS` in the script (currently `0002_old_tigra`).
- **DRIFT, not allowlisted**: fails the run. Verify what actually ran, ship a
  fresh migration if DDL is missing, and only then allowlist the tag if the
  difference is provably benign.
- **MISSING** (no row at the entry's `when` at all — the true silent-skip):
  always fails.

Limits of the neighbouring CI checks: "migrations in sync with schema" only
proves the committed migration files match `db/schema.ts` (it re-runs
`db:generate` and diffs the repo) — it never inspects a live database.
`db:verify` is the only live-DB check, and it compares bookkeeping history, not
`information_schema`. It runs in CI **immediately after every
`pnpm db:migrate`** — `ci.yml` (`db-migrate` job), `migrate.yml`,
`migrate-preview.yml`, and `seed-prod.yml` — so a journal/DB divergence fails
the workflow instead of surfacing as a runtime 500. Run it by hand against any
environment: `DATABASE_URL='<connection-string>' pnpm db:verify`.

## Environment

`DATABASE_URL` must be set in `.env`. Copy `.env.example` to get started.

## Production migrations

Production migrations are applied **automatically by CI**, not by hand.

- **Automatic:** `.github/workflows/migrate.yml` runs `pnpm db:migrate` against
  production whenever a push to `main` changes `db/schema.ts` or
  `db/migrations/**` (i.e. when a schema PR merges).
- **On demand:** trigger the same workflow from the Actions tab or
  `gh workflow run "Migrate production database"` — use this for the first
  apply, or to force a run.
- **Secret:** the workflow reads `PROD_DATABASE_URL` (repo Actions secret;
  distinct from `CI_E2E_DATABASE_URL`, which targets the throwaway CI branch).
  If unset the workflow skips with a warning instead of failing.
- **Manual fallback** (one-off):
  `DATABASE_URL='<prod-connection-string>' pnpm db:migrate`.

The CI **test** database (the `ci` Neon branch) is migrated once, up front, by
the dedicated `db-migrate` job in `ci.yml` that the `integration-e2e` and
`diff-coverage` jobs `needs:` — so a brand-new migration is applied and
recorded serially, before the parallel integration suites (which each call
`migrate()`) can race to apply it. The prod and CI branches never share a
connection string.

## Preview migrations (`migrate-preview.yml`, AUB-139)

The Neon↔Vercel integration forks each PR's **preview** database branch
(`preview/<git-branch>`) from **production**, and prod isn't migrated until the
PR merges — so without help, a schema-changing PR's preview 500s.

`.github/workflows/migrate-preview.yml` closes that gap: it runs on every
`pull_request` (its check is required by the branch ruleset, so it must always
report — a trigger-level `paths:` filter would leave the check stuck "Expected"
and block unrelated PRs), and a first in-job `relevance` step no-ops it with
success unless the PR changes `db/schema.ts`, `db/migrations/**`, or the seed
inputs. When relevant, it resolves the preview branch's Neon connection URI via
the Neon API (`.github/scripts/resolve-preview-db-url.mjs`), runs
`pnpm db:migrate` against it, and then **seeds** it (`pnpm db:seed`) so the
preview matches the PR's schema and shows real density. The seed step is free
(API-free baked data; see the seeding section) and a graceful no-op when the
baked file is empty.

- **Config:** `NEON_API_KEY` — a **repo Secret** (required; sensitive). Absent →
  the workflow skips with a warning (also the case for fork PRs, where secrets
  are withheld). `NEON_PROJECT_ID` — a **repo Variable** (preferred) or Secret;
  an identifier, not a credential. Optional: the resolver auto-detects the
  project when the key has a single one, but an **organization-scoped** API key
  needs it set explicitly (its `GET /projects` 400s otherwise).
- **Timing:** the branch lookup retries, since Vercel may still be creating the
  preview branch right after a first deploy; if it never appears the migrate
  step skips (a later push re-runs it). Idempotent — safe to re-run.

## Seeding the first admin (`pnpm db:seed-admin`)

The in-app role tool (`setRole`, ADR-010) can only grant/revoke `moderator` —
it cannot mint an admin. The first admin must be promoted out-of-band, **once
per database/environment** — an irreducible `safe:human` bootstrap (it needs
that env's `DATABASE_URL`).

It cannot be pre-seeded: identity anchors on the Google subject (`google_sub`,
ADR-006), and a `users` row only exists **after that account signs in once**.
The command never inserts; it only promotes an existing row.

### Per-environment flow

Run once per environment:

1. **Sign in once** to the app with the Google account that should be admin
   (this creates the `users` row).
2. Run the helper against that environment's `DATABASE_URL`:

   ```bash
   pnpm db:seed-admin anthony@brbcoding.com
   ```

   - **Local** — uses the `DATABASE_URL` in your `.env`.
   - **Production** — point at it explicitly:

     ```bash
     DATABASE_URL='<prod-connection-string>' pnpm db:seed-admin anthony@brbcoding.com
     ```

Idempotent: re-running on a user already `admin` is a no-op success. If the
user hasn't signed in yet, it exits non-zero with an actionable message.
Missing/empty email prints usage and exits non-zero.

The script reads `DATABASE_URL` through `getEnv()` (never raw `process.env`)
and runs via `node --experimental-strip-types` plus a dependency-free alias
loader (`scripts/register-aliases.mjs`) — no `tsx`/`ts-node`. See
`scripts/seed-admin.ts`.

## Seeding Denver listings (`pnpm db:seed`, AUB-31)

Seeds the directory with a curated set of real Denver-metro GF/celiac spots,
with GF-attribute labels **suggested by a curator bot**. The pipeline splits
the Places API call away from the seed so `pnpm db:seed` is **API-free**:

1. **Sources (edit these):** `scripts/seed-sources.ts` holds the human-curated
   `SEED_SOURCES` — a Places `query` per spot plus the labels the bot should
   suggest.
2. **Refresh (Places, one-time):** `pnpm db:seed:refresh`
   (`scripts/refresh-seed-data.ts`) resolves each `query` to a real Google
   Place ID + coordinates (+ Google's `googleMapsUri` share link, preferred as
   the seeded `mapsUrl`) via Places Text Search (biased to Union Station,
   hard-capped at a 50-mile radius) and **bakes** the resolved entries
   into `scripts/seed-listings.generated.json`. Needs **only**
   `GOOGLE_PLACES_API_KEY` (via `getPlacesApiKey()`; no DB connection, so no
   `DATABASE_URL`). Anything unresolvable or outside 50 miles is skipped and
   logged, never guessed. Run it (and commit the regenerated JSON) whenever you
   curate the sources — locally, or with the **"Refresh seed data"** GitHub
   Action (`.github/workflows/refresh-seed-data.yml`, `workflow_dispatch`),
   which uses the `GOOGLE_PLACES_API_KEY` secret and commits the JSON back to
   the branch. This is the **only** step that spends Places API calls — never
   `pnpm db:seed`.
3. **Chain fan-out (Places, optional):** `pnpm db:seed:expand-chains`
   (`scripts/expand-chain-locations.ts`) enumerates the other in-radius
   locations of every curated chain carrying `chainWideAttributes` (one Text
   Search per brand) and bakes them into
   `scripts/seed-chain-locations.generated.json`. Expanded locations inherit
   ONLY that corporate-policy attribute subset — never the flagship's full
   set. Runs locally or via the **"Expand chain locations"** Action
   (`.github/workflows/expand-chain-locations.yml`, `workflow_dispatch`).
4. **Baked data (committed, generated):** `scripts/seed-listings.generated.json`
   and `scripts/seed-chain-locations.generated.json` are the captured outputs —
   **do not hand-edit them**. `scripts/seed-data.ts` parses and concatenates
   them into `SEED_LISTINGS`.
5. **Seed (API-free):** `pnpm db:seed` inserts the baked `SEED_LISTINGS`
   directly — it never calls Places. If the baked file is empty it prints a
   hint to run the refresh first and exits 0.

- **Command:** `pnpm db:seed` — needs only `DATABASE_URL` (via `getDb()`); no
  network call.
- **Adding a captured field:** extend the field mask + `SeededListing` shape in
  `scripts/refresh-seed-data.ts` (and `seed-data.ts`), widen `ALLOWED_KEYS` in
  `scripts/seed-data.invariant.test.ts`, then re-run `pnpm db:seed:refresh` and
  commit the regenerated JSON. ADR-014 guardrail: no *new* Google Places field
  may be baked here — ratings, hours, phone, photos and reviews are
  render-time-fetch-only. The bake's existing `name` / `address` /
  `googleMapsUri` are the accepted risk ADR-014 §1 records, not a licence to
  add more; whether that posture covers a committed bake at all is an open
  owner question (AUB-288).
- **Curator bot:** a single `users` row (`Aubrey's Bot`, role `user`) that is
  intrinsically collision-proof with any real account on both unique columns —
  a non-numeric sentinel `google_sub` (`seed:aubreys-bot`) no real Google login
  can produce, and an un-routable `.invalid` email (`aubreys-bot@seed.invalid`,
  RFC 2606) no real Google mailbox can equal. Safe to seed in **every**
  environment, including production. (Contrast `db:seed-admin`, which must
  never insert a real-email row — see above.)
- **Suggestions, not votes:** a seeded label sets
  `claims.suggested_by = <bot id>` (NOT an attestation), so it shows a
  "Suggested by Aubrey's Bot" badge, stays out of the confirm/dispute counts
  (ADR-007), and is cleared automatically by the first real `castVote` on that
  claim.
- **Idempotent:** listings dedup on the unique Place ID; a claim is only
  suggested when its `(listing, attribute)` slot doesn't already exist, so a
  slot a real user has engaged with is never re-suggested. Re-run freely.
  (Dedup is Place-ID-scoped, not name-scoped: if Google ever returns a
  different Place ID for the same spot it would seed as a separate listing —
  rare, and a real user can flag/merge it.)
- **Typed menu links (AUB-220):** an entry's `menuUrl` is seeded as a
  `menu`-kind `listing_links` row (`created_by` null), never the legacy
  `listings.menu_url` column — and **only for listings the run itself
  inserted**. An existing listing is never touched: a user who *removed* their
  menu link leaves no row for `onConflictDoNothing` to protect, so seeding into
  existing listings would resurrect deleted links on every re-run. (Known
  tradeoff: the listing and link inserts are not transactional, so a run that
  dies between them leaves a listing whose menu link no re-run will seed —
  recover via the detail-page edit dialog or a manual insert.)

### Per-environment

- **Local / dev:** `pnpm db:seed` against your `.env` `DATABASE_URL`.
- **Production:** run the **"Seed production database"** GitHub Action
  (`.github/workflows/seed-prod.yml`, `workflow_dispatch`). It applies
  migrations then seeds, using only the `PROD_DATABASE_URL` secret (the seed is
  API-free), and skips-with-a-warning if it is unset. Re-runnable.
- **CI (E2E branch):** seeded **only** by `tests/e2e/seeded-listings.spec.ts`
  (AUB-196), which runs the idempotent `seedListings` core so the curated baked
  set is standing data on the persistent branch. Everything else keeps the
  rule: the E2E fixtures (`tests/e2e/fixtures.ts`) own their state via per-run
  tokens + cleanup, and no spec may assume an empty directory or fixed row
  counts (see the curated-seed carve-out in `docs/agents/testing.md`).

The testable core is {@link seedListings} with its DB injected; the Places
capture lives in {@link refreshSeedData} with its resolver injected. See
`scripts/seed.ts`, `scripts/refresh-seed-data.ts`, `scripts/seed-sources.ts`,
and `scripts/seed-data.ts`.

## Backfilling listing maps URLs (`pnpm db:backfill:maps-urls`)

Rewrites rows whose `maps_url` is in the legacy
`https://www.google.com/maps/place/?q=place_id:…` format (which Google Maps no
longer resolves) to the documented Maps URLs API format
(`/maps/search/?api=1&query=<name address>&query_place_id=<place id>`), using
columns already on each row. Script: `scripts/backfill-maps-urls.ts`. API-free,
needs only `DATABASE_URL`, idempotent (a rewritten row never matches the legacy
prefix again). Legacy-format rows with no Place ID are reported and left
untouched, never guessed.

- **Local / dev:** `pnpm db:backfill:maps-urls` against your `.env`
  `DATABASE_URL`.
- **Production:** run the **"Backfill production maps URLs"** GitHub Action
  (`.github/workflows/backfill-maps-urls.yml`, `workflow_dispatch`) — uses the
  `PROD_DATABASE_URL` secret, skips-with-a-warning if unset.

New listings don't need it: the Places provider stores Google's own share link
(`googleMapsUri`) and only falls back to the built Maps URLs API link when that
field is absent.

## Backfilling listing links (`pnpm db:backfill:listing-links`)

Migrates any listing still carrying its menu link only in the legacy
`listings.menu_url` column into a typed `menu`-kind `listing_links` row
(AUB-202), then clears the migrated column. API-free (needs only
`DATABASE_URL`) and idempotent: the insert is `onConflictDoNothing` on the
`(listing, kind)` unique constraint, so a user-edited link is never
overwritten. Non-http(s) legacy values are reported and left untouched.

- **Local / dev:** `pnpm db:backfill:listing-links` against your `.env`
  `DATABASE_URL` — useful for a dev database with pre-AUB-202 rows.
- **Production:** already backfilled; the one-time GitHub Action is retired
  (AUB-221), and nothing re-mints legacy rows — intake and the seed pipeline
  write typed rows only (AUB-220). If a re-run is ever needed:
  `DATABASE_URL='<prod-connection-string>' pnpm db:backfill:listing-links`.

## Production Incidents

When a migration breaks production or data is at risk, see the **[Migration
Rollback Runbook](../setup/migration-rollback-runbook.md)** (AUB-154):
forward-fixing migrations (most common) and Neon PITR restore as a fallback for
destructive changes.
