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
        // Sentry/TanStack bootstrap: side-effecting entry files (client
        // Sentry.init, custom SSR fetch wrapper, createStart middleware
        // registration), in the same not-meaningfully-unit-testable category as
        // client.tsx/router.tsx.
        "app/instrument.client.ts",
        "app/server.ts",
        "app/start.ts",
        "app/routes/**",
        "app/**/*.d.ts",
      ],
      // Absolute coverage floor (AUB-169), on top of the existing
      // changed-lines-only diff-coverage gate (issue #183,
      // .github/scripts/check-diff-coverage.mjs). Diff coverage alone lets
      // AGGREGATE coverage drift down over many PRs that each individually clear
      // 80% on their own changed lines; this whole-repo floor catches that decay.
      //
      // Where this runs: Vitest enforces `coverage.thresholds` (failing the
      // process) any time `--coverage` is passed. In this repo that is the
      // `pnpm test:coverage` script, which runs in CI in the "Diff coverage" job's
      // "Test with coverage" step (.github/workflows/ci.yml) — so a whole-repo
      // regression below the floor fails that job before the diff-coverage script
      // even runs. It also fires locally for anyone who runs `pnpm test:coverage`.
      // The fast `unit` CI job does not pass `--coverage`, so it is unaffected.
      //
      // Baseline measured 2026-07-05 on a from-scratch DB-free run (no
      // DATABASE_URL/TEST_DATABASE_URL — matches this repo's sandboxed/no-secret
      // CI path, which is the LOWER of the two coverage modes since the
      // integration suite only ever adds coverage, never removes it):
      //   statements 91.62% | branches 88.04% | functions 86.02% | lines 91.59%
      // RE-BASELINED for Vitest 4 (2026-07-05): @vitest/coverage-v8 v4 remaps
      // V8 coverage via the AST (Istanbul-like semantics), so the SAME code +
      // tests measure a few points lower than v3 did (2026-07-03 v3 baseline:
      // statements 93.59 | branches 92.13 | functions 87.45 | lines 93.59).
      // This is a measurement-methodology change, not a coverage regression.
      // Thresholds below sit ~2-3 points under the measured baseline —
      // deliberate headroom so unrelated in-flight work doesn't trip this floor
      // the moment it lands, while still catching a real regression. Re-measure
      // with `pnpm test:coverage` and ratchet these up over time as coverage
      // improves; do not lower them to make a failing PR pass.
      thresholds: {
        statements: 89,
        branches: 85,
        functions: 83,
        lines: 89,
      },
    },
  },
});
