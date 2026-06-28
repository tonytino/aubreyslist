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

The CI **test** database (the `ci` Neon branch) is migrated separately inside the
E2E job in `ci.yml`; the two never share a connection string.

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
