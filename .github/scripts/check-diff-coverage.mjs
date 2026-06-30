#!/usr/bin/env node

// Diff-coverage gate (issue #183, part of #178). Fails a PR when the lines it
// ADDS or CHANGES are not covered by tests at or above THRESHOLD (%). Coverage
// is measured ONLY on changed lines — legacy untested code is never retroactively
// failed, so the gate is safe to drop onto an existing tree.
//
// Zero dependencies (Node ESM + git/`coverage-final.json` only). The matching
// logic lives in exported PURE functions (no FS/git inside them) so it is
// unit-testable in isolation; main() does all the IO. Tests live in
// tests/unit/diff-coverage.test.ts (Vitest's include globs do not cover
// .github/**, so the test file lives where Vitest discovers it).
//
// Mirrors the in-repo guard style (.github/scripts/check-hard-rules.mjs and
// check-changelog-tags.mjs): `::error file=…,line=…::` annotations, a legible
// summary, exit 1 on failure / 0 when clean.
//
// HOW COVERAGE IS SOURCED (the load-bearing design decision): app/server/** is
// largely exercised only by the DB-gated integration suite. So the CI job that
// runs this script runs the FULL suite (unit + integration) under the same
// `CI_E2E_DATABASE_URL` secret gate as `integration-e2e`, and self-skips when the
// secret is absent (rather than false-failing changed server lines as
// uncovered). See the `diff-coverage` job in .github/workflows/ci.yml.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Changed-line coverage must be >= this percentage or the gate fails. Read from
// the DIFF_COVERAGE_THRESHOLD env var (CI may override) with an 80% default.
export const DEFAULT_THRESHOLD = 80;

// ---------------------------------------------------------------------------
// Pure functions (no FS, no git, no process). Unit-tested in isolation.
// ---------------------------------------------------------------------------

/**
 * Parse a v8/istanbul `coverage-final.json` object into per-file line coverage.
 *
 * Each entry has a `statementMap` (statement id -> { start:{line}, end:{line} })
 * and `s` (statement id -> hit count). We derive, for each file:
 *   - `coverable`: the set of line numbers spanned by ANY statement.
 *   - `covered`:   the set of line numbers spanned by a statement with hits > 0.
 * A line counts as covered if any statement covering it ran at least once.
 *
 * Keys are normalized to whatever the report uses (absolute paths from v8); the
 * caller reconciles them against git's repo-relative paths via `matchCoverage`.
 *
 * @param {object} report Parsed coverage-final.json.
 * @returns {Map<string, { coverable: Set<number>, covered: Set<number> }>}
 */
export function parseCoverage(report) {
  const byFile = new Map();
  for (const [key, entry] of Object.entries(report ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    const statementMap = entry.statementMap ?? {};
    const hits = entry.s ?? {};
    const coverable = new Set();
    const covered = new Set();
    for (const [id, loc] of Object.entries(statementMap)) {
      const start = loc?.start?.line;
      const end = loc?.end?.line ?? start;
      if (typeof start !== "number") continue;
      const hit = (hits[id] ?? 0) > 0;
      for (let line = start; line <= end; line++) {
        coverable.add(line);
        if (hit) covered.add(line);
      }
    }
    const path = typeof entry.path === "string" ? entry.path : key;
    byFile.set(path, { coverable, covered });
  }
  return byFile;
}

/**
 * Parse `git diff` unified output into a map of file -> set of ADDED/changed
 * line numbers on the RIGHT-HAND (new) side.
 *
 * We track the post-image line counter from each hunk header
 * `@@ -a,b +c,d @@` and record every `+` line (added/changed), skipping `-`
 * lines (which don't exist in the new file) and the `+++ ` file header. Renames
 * and binary diffs carry no `+` content lines, so they contribute nothing.
 *
 * @param {string} diff Raw `git diff` output.
 * @returns {Map<string, Set<number>>} file (repo-relative) -> added line numbers.
 */
export function parseDiff(diff) {
  const byFile = new Map();
  let current = null;
  let newLine = 0;
  for (const raw of String(diff ?? "").split("\n")) {
    if (raw.startsWith("+++ ")) {
      // `+++ b/path/to/file` (or `+++ /dev/null` for deletions).
      const target = raw.slice(4);
      if (target === "/dev/null") {
        current = null;
        continue;
      }
      // Strip the `b/` prefix git adds; tolerate a missing prefix.
      current = target.startsWith("b/") ? target.slice(2) : target;
      if (!byFile.has(current)) byFile.set(current, new Set());
      continue;
    }
    if (raw.startsWith("@@")) {
      // @@ -oldStart,oldCount +newStart,newCount @@ optional section heading
      const m = raw.match(/\+(\d+)/);
      newLine = m ? Number(m[1]) : 0;
      continue;
    }
    if (current === null) continue;
    if (raw.startsWith("+++")) continue; // already handled; defensive.
    if (raw.startsWith("+")) {
      byFile.get(current).add(newLine);
      newLine++;
    } else if (raw.startsWith("-")) {
      // Removed line: not present in the new file, don't advance newLine.
    } else if (raw.startsWith("\\")) {
      // "\ No newline at end of file" — metadata, ignore.
    } else {
      // Context line (starts with a space) or blank separator: advances newLine.
      newLine++;
    }
  }
  return byFile;
}

/**
 * Reconcile a repo-relative diff path against the coverage map's keys (which v8
 * writes as absolute paths). Returns the matching coverage key, or null if the
 * file is not in the coverage report (i.e. excluded by vitest.config.ts
 * include/exclude — those changed lines are not gated).
 *
 * @param {string} relPath Repo-relative POSIX path from the diff.
 * @param {Map<string, unknown>} coverageByFile Output of parseCoverage().
 * @returns {string | null}
 */
export function matchCoverage(relPath, coverageByFile) {
  if (coverageByFile.has(relPath)) return relPath;
  for (const key of coverageByFile.keys()) {
    // Absolute path ending in the repo-relative path (with a separator boundary).
    if (key.endsWith(`/${relPath}`) || key === relPath) return key;
  }
  return null;
}

/**
 * Intersect changed lines with coverage to compute diff coverage.
 *
 * For every changed line that is COVERABLE in a coverage-eligible file, count it
 * as covered/uncovered. Changed lines in files absent from the coverage report
 * (excluded by config) or that are not coverable (blank lines, comments, type-only
 * positions v8 doesn't instrument) are ignored — only executable changed lines
 * are gated.
 *
 * @param {Map<string, Set<number>>} diffByFile Output of parseDiff().
 * @param {Map<string, { coverable: Set<number>, covered: Set<number> }>} coverageByFile
 * @returns {{ total: number, covered: number, uncovered: Array<{ file: string, line: number }> }}
 */
export function computeDiffCoverage(diffByFile, coverageByFile) {
  let total = 0;
  let covered = 0;
  const uncovered = [];
  for (const [relPath, lines] of diffByFile) {
    const key = matchCoverage(relPath, coverageByFile);
    if (key === null) continue; // file not coverage-eligible.
    const fileCov = coverageByFile.get(key);
    for (const line of [...lines].sort((a, b) => a - b)) {
      if (!fileCov.coverable.has(line)) continue; // non-executable changed line.
      total++;
      if (fileCov.covered.has(line)) covered++;
      else uncovered.push({ file: relPath, line });
    }
  }
  return { total, covered, uncovered };
}

/**
 * Compute the coverage percentage for a result. Returns 100 when there are no
 * coverable changed lines (nothing to gate => pass).
 *
 * @param {{ total: number, covered: number }} result
 * @returns {number} Percentage in [0, 100].
 */
export function coveragePercent({ total, covered }) {
  if (total === 0) return 100;
  return (covered / total) * 100;
}

// ---------------------------------------------------------------------------
// IO orchestration (main). Not exported; only runs when invoked directly.
// ---------------------------------------------------------------------------

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function resolveBase() {
  const fromEnv = process.env.BASE_SHA?.trim();
  if (fromEnv) return fromEnv;
  // Fallback: merge-base against origin/main. In a shallow/odd checkout this can
  // fail; surface a clear message rather than a cryptic git error.
  try {
    return git(["merge-base", "origin/main", "HEAD"]).trim();
  } catch {
    console.error(
      "::error::check-diff-coverage: could not determine a base ref. Set BASE_SHA or ensure origin/main is fetched (git fetch --no-tags origin main)."
    );
    process.exit(2);
  }
}

function main() {
  const threshold = Number(process.env.DIFF_COVERAGE_THRESHOLD ?? DEFAULT_THRESHOLD);
  const coveragePath = process.env.COVERAGE_JSON ?? "coverage/coverage-final.json";

  const base = resolveBase();
  // `<base>...HEAD` diffs against the merge-base, so unrelated changes already on
  // main don't count as "this PR's" lines.
  const diffText = git(["diff", "--unified=0", `${base}...HEAD`]);

  let report;
  try {
    report = JSON.parse(readFileSync(coveragePath, "utf8"));
  } catch (err) {
    console.error(
      `::error::check-diff-coverage: could not read ${coveragePath} (${err.message}). Run \`pnpm test:coverage\` first.`
    );
    process.exit(2);
  }

  const coverageByFile = parseCoverage(report);
  const diffByFile = parseDiff(diffText);
  const result = computeDiffCoverage(diffByFile, coverageByFile);
  const pct = coveragePercent(result);

  console.log(`Diff coverage (changed lines vs ${base.slice(0, 12)}):`);
  console.log(`  threshold:        ${threshold}%`);
  console.log(`  coverable changed lines: ${result.total}`);
  console.log(`  covered:          ${result.covered}`);
  console.log(`  uncovered:        ${result.uncovered.length}`);
  console.log(`  diff coverage:    ${pct.toFixed(2)}%`);

  if (result.total === 0) {
    console.log("✓ No coverable changed lines to gate — passing.");
    process.exit(0);
  }

  if (result.uncovered.length > 0) {
    console.log("\nUncovered changed lines:");
    for (const { file, line } of result.uncovered) {
      console.log(
        `::error file=${file},line=${line}::Changed line is not covered by tests (diff-coverage gate, issue #183). Add a test that exercises it, or refactor so it is covered.`
      );
    }
  }

  if (pct + 1e-9 < threshold) {
    console.error(
      `\n✗ Diff coverage ${pct.toFixed(2)}% is below the ${threshold}% threshold (${result.covered}/${result.total} changed lines covered). Cover the lines flagged above and re-run \`pnpm test:coverage && node .github/scripts/check-diff-coverage.mjs\`.`
    );
    process.exit(1);
  }
  console.log(`\n✓ Diff coverage ${pct.toFixed(2)}% meets the ${threshold}% threshold.`);
}

// Only run when invoked directly (not when imported by the unit tests).
if (process.argv[1]?.endsWith("check-diff-coverage.mjs")) {
  main();
}
