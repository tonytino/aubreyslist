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
