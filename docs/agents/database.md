# Database

Stack: Drizzle ORM + Neon (serverless Postgres).

## Key Files

| File                  | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `db/schema.ts`        | Single source of truth for all table definitions     |
| `db/client.ts`        | Drizzle + Neon client — call `getDb()` from here     |
| `db/migrations/`      | Auto-generated migration files — never edit manually |
| `drizzle.config.ts`   | Drizzle Kit config                                   |

`db/migrations/` does not exist until you run `pnpm db:generate` for the first time — Drizzle Kit creates it from `db/schema.ts`. Don't hand-create or hand-edit it.

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

- `db` is **server-only**. Never import it in components, hooks, or any file that runs in the browser.
- **Never create or alter tables directly in the database** (e.g. the Neon SQL editor/console). All schema changes go through `db/schema.ts` + `pnpm db:generate` / `pnpm db:migrate`. Hand-written DDL causes drift between the DB and migrations.
- Never edit files in `db/migrations/` manually.
- Always export `$inferSelect` and `$inferInsert` types alongside new tables.
- Use `pnpm db:studio` to inspect the database visually during development.

## Environment

`DATABASE_URL` must be set in `.env`. Copy `.env.example` to get started.

## Production migrations

Production migrations are applied **automatically by CI**, not by hand — no PR
author is ever a blocker for a schema change.

- **Automatic:** the `.github/workflows/migrate.yml` workflow runs `pnpm db:migrate`
  against the production database whenever a push to `main` changes `db/schema.ts`
  or `db/migrations/**` (i.e. when a schema PR merges).
- **On demand:** trigger the same workflow from the Actions tab ("Run workflow")
  or `gh workflow run "Migrate production database"` — use this for the **first
  apply**, or any time you want to force a run.
- **Secret:** the workflow reads `PROD_DATABASE_URL` (a repo Actions secret
  pointing at the production database — distinct from `CI_E2E_DATABASE_URL`,
  which targets the throwaway CI branch). If it's unset the workflow skips with a
  warning instead of failing.
- **Manual fallback** (one-off): `DATABASE_URL='<prod-connection-string>' pnpm db:migrate`.

The CI **test** database (the `ci` Neon branch) is migrated once, up front, by the
dedicated `db-migrate` job in `ci.yml` that the `integration-e2e` and `diff-coverage`
jobs `needs:` — so a brand-new migration is applied and recorded serially, before the
parallel integration suites (which each call `migrate()`) can race to apply it. The
prod and CI branches never share a connection string.

## Preview migrations (`migrate-preview.yml`, AUB-139)

The Neon↔Vercel integration forks each PR's **preview** database branch
(`preview/<git-branch>`) from **production**, and prod isn't migrated until the PR
merges — so without help, a schema-changing PR's preview 500s (the deployed preview
code queries a column/table the preview DB doesn't have yet).

`.github/workflows/migrate-preview.yml` closes that gap: on a `pull_request` that
changes `db/schema.ts` or `db/migrations/**`, it resolves the preview branch's Neon
connection URI via the Neon API (`.github/scripts/resolve-preview-db-url.mjs`) and
runs `pnpm db:migrate` against it, so the preview matches the PR's schema.

- **Secrets:** `NEON_API_KEY` (required) and `NEON_PROJECT_ID` (optional — the
  resolver auto-detects a sole project). Absent → the workflow skips with a warning
  (also the case for fork PRs, where secrets are withheld).
- **Timing:** the branch lookup retries, since Vercel may still be creating the
  preview branch right after a first deploy; if it never appears the migrate step
  skips (a later push re-runs it). Idempotent — safe to re-run.

## Seeding the first admin (`pnpm db:seed-admin`)

The in-app role tool (`setRole`, ADR-010) can only grant/revoke the `moderator`
role — it **cannot mint an admin**. So the first admin (the repo owner) must be
promoted out-of-band, **once per database/environment**. This is a documented,
irreducible `safe:human` bootstrap (you need that env's `DATABASE_URL`), not
something an agent can automate away.

Why it can't be pre-seeded: identity anchors on the Google subject
(`google_sub`, ADR-006), and a `users` row only exists **after that account signs
in once**. Seeding by email alone would create an orphaned, unreachable row — so
this command never inserts; it only promotes an existing row.

### Per-environment flow

For each environment, run this **once**:

1. **Sign in once** to the app with the Google account that should be admin
   (this creates the `users` row).
2. Run the helper against that environment's `DATABASE_URL`:

   ```bash
   pnpm db:seed-admin anthony@brbcoding.com
   ```

   - **Local** — uses the `DATABASE_URL` in your `.env` (your dev DB, if it is
     separate from prod).
   - **Production** — the Neon database behind Vercel. Point the command at it
     explicitly with that connection string, e.g.:

     ```bash
     DATABASE_URL='<prod-connection-string>' pnpm db:seed-admin anthony@brbcoding.com
     ```

It is **idempotent**: re-running on a user who is already `admin` is a no-op
success. If the user hasn't signed in yet, it exits non-zero with an actionable
message ("sign in once with this Google account first, then re-run"). Missing or
empty email argument prints usage and exits non-zero.

The script reads `DATABASE_URL` through the validated `getEnv()` accessor (never
raw `process.env`) and runs via `node --experimental-strip-types` plus a small
dependency-free alias loader (`scripts/register-aliases.mjs`) — no `tsx`/`ts-node`
dependency is added. See `scripts/seed-admin.ts`.

## Seeding Denver listings (`pnpm db:seed`, AUB-31)

Seeds the directory with a curated set of real Denver-metro gluten-free / celiac
spots (`scripts/seed-data.ts`) so it has density before real users arrive. Each
entry is resolved to a **real Google Place ID + coordinates** via Places Text
Search (biased to Union Station, hard-capped at a 25-mile radius), then inserted
with one or more GF-attribute "labels" **suggested by a curator bot**.

- **Command:** `pnpm db:seed` — needs `DATABASE_URL` **and** `GOOGLE_PLACES_API_KEY`
  (both read via `getEnv()`). Anything the API can't resolve, or that falls
  outside 25 miles, is skipped and logged, never guessed.
- **Curator bot:** a single `users` row (`Aubrey's Bot`, role `user`) that is
  **intrinsically collision-proof** with any real account on both unique columns —
  a **non-numeric sentinel `google_sub`** (`seed:aubreys-bot`) a real Google login
  can never produce, and an **un-routable `.invalid` email** (`aubreys-bot@seed.invalid`,
  RFC 2606) no real Google mailbox can equal. So it is safe to seed in **every**
  environment, including production, and can never break a future real sign-in on
  the UNIQUE email constraint. (Contrast `db:seed-admin`, which must never insert a
  real-email row — see above.)
- **Suggestions, not votes:** a seeded label sets `claims.suggested_by = <bot id>`
  (NOT an attestation), so it shows a "Suggested by Aubrey's Bot" badge, stays out
  of the confirm/dispute counts (ADR-007), and is cleared automatically by the
  first real `castVote` on that claim.
- **Idempotent:** listings dedup on the unique Place ID; a claim is only suggested
  when its `(listing, attribute)` slot doesn't already exist, so a slot a real user
  has engaged with is never re-suggested. Re-run freely as you curate the data.
  (Dedup is **Place-ID-scoped**, not name-scoped: idempotency holds as long as a
  query keeps resolving to the same Google Place ID. If Google ever returns a
  different Place ID for the same spot, it would seed as a separate listing — rare,
  and a real user can flag/merge it.)

### Per-environment

- **Local / dev:** `pnpm db:seed` against your `.env` `DATABASE_URL`.
- **Production:** run the **"Seed production database"** GitHub Action
  (`.github/workflows/seed-prod.yml`, `workflow_dispatch`). It applies migrations
  then seeds, using the `PROD_DATABASE_URL` and `GOOGLE_PLACES_API_KEY` Actions
  secrets, and skips-with-a-warning if either is unset. Re-runnable from the
  Actions tab.
- **CI (E2E branch):** intentionally **not** auto-seeded — the E2E fixtures
  (`tests/e2e/fixtures.ts`) own their state via per-run tokens + cleanup, and a
  pre-seeded directory would risk flaky count/empty-state assertions.

The testable core is {@link seedListings} with its DB + Places resolver injected;
the CLI shell wires the real ones. See `scripts/seed.ts` / `scripts/seed-data.ts`.
