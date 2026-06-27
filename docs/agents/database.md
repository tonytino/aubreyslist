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
- Never edit files in `db/migrations/` manually.
- **Never create or alter tables directly in the database** (e.g. the Neon SQL editor/console, or any hand-written DDL). All schema changes go through `db/schema.ts` + `pnpm db:generate` → `pnpm db:migrate`. Writing DDL straight to the database causes drift between the live schema and the migrations — the database must only ever be changed by applying migrations.
- Always export `$inferSelect` and `$inferInsert` types alongside new tables.
- Use `pnpm db:studio` to inspect the database visually during development.

## Environment

`DATABASE_URL` must be set in `.env`. Copy `.env.example` to get started.
