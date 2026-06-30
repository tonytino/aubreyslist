import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs script, no type declarations
import * as gate from "../../.github/scripts/check-diff-coverage.mjs";

const {
  parseCoverage,
  parseDiff,
  matchCoverage,
  computeDiffCoverage,
  coveragePercent,
  DEFAULT_THRESHOLD,
} = gate;

// Build a minimal v8/istanbul coverage entry from a list of
// [statementId, startLine, endLine, hits] tuples.
function covEntry(path: string, statements: Array<[string, number, number, number]>) {
  const statementMap: Record<string, unknown> = {};
  const s: Record<string, number> = {};
  for (const [id, start, end, hits] of statements) {
    statementMap[id] = { start: { line: start, column: 0 }, end: { line: end, column: 0 } };
    s[id] = hits;
  }
  return { [path]: { path, statementMap, s, branchMap: {}, b: {}, fnMap: {}, f: {} } };
}

describe("parseCoverage", () => {
  it("derives coverable + covered line sets from statementMap and s", () => {
    const report = covEntry("/repo/app/trust/summary.ts", [
      ["0", 1, 1, 3], // covered
      ["1", 2, 2, 0], // coverable, not covered
      ["2", 5, 6, 1], // multi-line statement, covered
    ]);
    const map = parseCoverage(report);
    const file = map.get("/repo/app/trust/summary.ts");
    expect([...file.coverable].sort((a, b) => a - b)).toEqual([1, 2, 5, 6]);
    expect([...file.covered].sort((a, b) => a - b)).toEqual([1, 5, 6]);
  });

  it("handles multi-file reports", () => {
    const report = {
      ...covEntry("/repo/app/a.ts", [["0", 1, 1, 1]]),
      ...covEntry("/repo/app/b.ts", [["0", 9, 9, 0]]),
    };
    const map = parseCoverage(report);
    expect(map.size).toBe(2);
    expect(map.get("/repo/app/a.ts").covered.has(1)).toBe(true);
    expect(map.get("/repo/app/b.ts").covered.has(9)).toBe(false);
  });

  it("tolerates empty/garbage input", () => {
    expect(parseCoverage({}).size).toBe(0);
    expect(parseCoverage(null).size).toBe(0);
  });
});

describe("parseDiff", () => {
  it("records added/right-hand line numbers from a single hunk", () => {
    const diff = [
      "diff --git a/app/x.ts b/app/x.ts",
      "--- a/app/x.ts",
      "+++ b/app/x.ts",
      "@@ -1,2 +1,3 @@",
      " context",
      "+added line 2",
      "+added line 3",
      " trailing",
    ].join("\n");
    const map = parseDiff(diff);
    expect([...map.get("app/x.ts")].sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it("ignores removed lines and does not advance the new-side counter for them", () => {
    const diff = [
      "--- a/app/x.ts",
      "+++ b/app/x.ts",
      "@@ -1,3 +1,2 @@",
      " keep",
      "-removed",
      "+replacement",
    ].join("\n");
    // new line 1 = "keep" (context), removed line does not advance, "+replacement" is new line 2.
    const map = parseDiff(diff);
    expect([...map.get("app/x.ts")]).toEqual([2]);
  });

  it("handles multi-hunk, multi-file diffs", () => {
    const diff = [
      "--- a/app/a.ts",
      "+++ b/app/a.ts",
      "@@ -1,0 +1,1 @@",
      "+new in a",
      "@@ -10,0 +20,2 @@",
      "+line 20",
      "+line 21",
      "--- a/app/b.ts",
      "+++ b/app/b.ts",
      "@@ -5,0 +5,1 @@",
      "+new in b",
    ].join("\n");
    const map = parseDiff(diff);
    expect([...map.get("app/a.ts")].sort((a, b) => a - b)).toEqual([1, 20, 21]);
    expect([...map.get("app/b.ts")]).toEqual([5]);
  });

  it("ignores newly-deleted files (+++ /dev/null) and empty input", () => {
    const diff = ["--- a/app/gone.ts", "+++ /dev/null", "@@ -1,1 +0,0 @@", "-bye"].join("\n");
    expect(parseDiff(diff).size).toBe(0);
    expect(parseDiff("").size).toBe(0);
  });
});

describe("matchCoverage", () => {
  it("reconciles a repo-relative diff path against absolute coverage keys", () => {
    const cov = parseCoverage(covEntry("/home/runner/repo/app/trust/summary.ts", [["0", 1, 1, 1]]));
    expect(matchCoverage("app/trust/summary.ts", cov)).toBe(
      "/home/runner/repo/app/trust/summary.ts"
    );
  });

  it("returns null for files absent from the coverage report (excluded by config)", () => {
    const cov = parseCoverage(covEntry("/repo/app/trust/summary.ts", [["0", 1, 1, 1]]));
    expect(matchCoverage("app/routes/index.tsx", cov)).toBeNull();
  });
});

describe("computeDiffCoverage + coveragePercent", () => {
  const cov = parseCoverage(
    covEntry("/repo/app/trust/summary.ts", [
      ["0", 1, 1, 1], // covered
      ["1", 2, 2, 1], // covered
      ["2", 3, 3, 0], // coverable, uncovered
    ])
  );

  it("passes when every changed coverable line is covered", () => {
    const diff = parseDiff(
      [
        "--- a/app/trust/summary.ts",
        "+++ b/app/trust/summary.ts",
        "@@ -1,0 +1,2 @@",
        "+a",
        "+b",
      ].join("\n")
    );
    const result = computeDiffCoverage(diff, cov);
    expect(result.total).toBe(2);
    expect(result.covered).toBe(2);
    expect(result.uncovered).toEqual([]);
    expect(coveragePercent(result)).toBe(100);
  });

  it("fails when a changed coverable line is uncovered", () => {
    const diff = parseDiff(
      [
        "--- a/app/trust/summary.ts",
        "+++ b/app/trust/summary.ts",
        "@@ -1,0 +1,3 @@",
        "+a",
        "+b",
        "+c",
      ].join("\n")
    );
    const result = computeDiffCoverage(diff, cov);
    expect(result.total).toBe(3);
    expect(result.covered).toBe(2);
    expect(result.uncovered).toEqual([{ file: "app/trust/summary.ts", line: 3 }]);
    expect(coveragePercent(result)).toBeCloseTo(66.67, 1);
  });

  it("ignores changed lines outside coverage-eligible files", () => {
    const diff = parseDiff(
      [
        "--- a/app/routes/index.tsx",
        "+++ b/app/routes/index.tsx",
        "@@ -1,0 +1,1 @@",
        "+untracked",
      ].join("\n")
    );
    const result = computeDiffCoverage(diff, cov);
    expect(result.total).toBe(0);
    expect(coveragePercent(result)).toBe(100); // nothing to gate => pass
  });

  it("ignores changed lines that are not coverable (comments/blank)", () => {
    // Changed line 99 is not in any statement range => not gated.
    const diff = parseDiff(
      [
        "--- a/app/trust/summary.ts",
        "+++ b/app/trust/summary.ts",
        "@@ -99,0 +99,1 @@",
        "+// a comment",
      ].join("\n")
    );
    const result = computeDiffCoverage(diff, cov);
    expect(result.total).toBe(0);
  });

  it("treats an empty diff as passing", () => {
    const result = computeDiffCoverage(parseDiff(""), cov);
    expect(result.total).toBe(0);
    expect(coveragePercent(result)).toBe(100);
  });
});

describe("DEFAULT_THRESHOLD", () => {
  it("is 80", () => {
    expect(DEFAULT_THRESHOLD).toBe(80);
  });
});
