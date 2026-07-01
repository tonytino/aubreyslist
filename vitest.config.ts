import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: [
      "app/**/*.test.{ts,tsx}",
      "scripts/**/*.test.{ts,tsx}",
      "tests/unit/**/*.test.{ts,tsx}",
      // Integration tests hit a real Postgres; they self-skip (describe.skipIf)
      // unless TEST_DATABASE_URL is set, so they stay green with no database.
      "tests/integration/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      // `text`/`html` are for humans; `json` emits coverage/coverage-final.json,
      // the machine-readable Istanbul-shaped report consumed by the diff-coverage
      // gate (.github/scripts/check-diff-coverage.mjs, issue #183).
      reporter: ["text", "html", "json"],
      // Cover application/server/db source; exclude generated, config, and
      // entry/boilerplate files that aren't meaningfully unit-testable.
      include: ["app/**/*.{ts,tsx}", "db/**/*.ts"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "app/routeTree.gen.ts",
        "app/router.tsx",
        "app/client.tsx",
        "app/routes/**",
        "app/**/*.d.ts",
      ],
    },
  },
});
