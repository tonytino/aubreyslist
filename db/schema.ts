import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Define your tables here.
// Run `pnpm db:generate` after changes, then `pnpm db:migrate` to apply.

export const example = pgTable("example", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Export inferred types for use throughout the app
export type Example = typeof example.$inferSelect;
export type NewExample = typeof example.$inferInsert;
