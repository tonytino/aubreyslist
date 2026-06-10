import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["app/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Cover application/server/db source; exclude generated, config, and
      // entry/boilerplate files that aren't meaningfully unit-testable.
      include: ["app/**/*.{ts,tsx}", "db/**/*.ts"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "app/routeTree.gen.ts",
        "app/router.tsx",
        "app/client.tsx",
        "app/ssr.tsx",
        "app/routes/**",
        "app/**/*.d.ts",
      ],
    },
  },
});
