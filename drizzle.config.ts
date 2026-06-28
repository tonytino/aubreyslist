import { defineConfig } from "drizzle-kit";

// Intentional build-time tooling exception to the "never access process.env
// outside app/env.ts" rule (docs/agents/environment.md): Drizzle Kit runs as a
// CLI outside the app module graph, so the lazy `getEnv()` accessor cannot be
// imported here. Reading DATABASE_URL directly is accepted for this config only.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
