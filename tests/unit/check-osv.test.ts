import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs script, no type declarations
import * as osv from "../../.github/scripts/check-osv.mjs";

const {
  CRITICAL_SEVERITY_FLOOR,
  classifyFinding,
  compareVersions,
  extractFindings,
  groupSeverity,
  isExcludedFromCooldown,
  parseCooldownConfig,
  selectFixedVersion,
} = osv;

const SEVEN_DAYS_MIN = 10080;

/** Convenience: a classifyFinding call with sane defaults for the field under test. */
function classify(overrides: Record<string, unknown> = {}) {
  return classifyFinding({
    fixedVersion: "5.0.9",
    publishedAt: new Date("2026-07-30T10:00:00Z"),
    maxSeverity: 7.5,
    now: new Date("2026-08-01T00:00:00Z"),
    minimumReleaseAgeMinutes: SEVEN_DAYS_MIN,
    ...overrides,
  });
}

describe("compareVersions", () => {
  it("orders by numeric segment, not lexically", () => {
    expect(compareVersions("5.0.9", "5.0.10")).toBeLessThan(0);
    expect(compareVersions("10.2.5", "9.9.9")).toBeGreaterThan(0);
    expect(compareVersions("3.1.5", "3.1.5")).toBe(0);
  });

  it("treats missing segments as zero", () => {
    expect(compareVersions("5", "5.0.0")).toBe(0);
    expect(compareVersions("5.1", "5.0.9")).toBeGreaterThan(0);
  });

  it("sorts a prerelease below its release", () => {
    expect(compareVersions("5.0.9-rc.1", "5.0.9")).toBeLessThan(0);
    expect(compareVersions("5.0.9", "5.0.9-rc.1")).toBeGreaterThan(0);
  });
});

describe("parseCooldownConfig", () => {
  it("reads the real pnpm-workspace.yaml", () => {
    const cfg = parseCooldownConfig(readFileSync("pnpm-workspace.yaml", "utf8"));
    expect(cfg.minimumReleaseAgeMinutes).toBe(SEVEN_DAYS_MIN);
    expect(Array.isArray(cfg.exclude)).toBe(true);
  });

  it("parses the exclude block list", () => {
    const cfg = parseCooldownConfig(
      [
        "minimumReleaseAge: 10080",
        "minimumReleaseAgeExclude:",
        "  - hono@4.12.34",
        "  - lodash",
      ].join("\n")
    );
    expect(cfg.exclude).toEqual(["hono@4.12.34", "lodash"]);
  });

  it("ends the exclude block at the next top-level key", () => {
    const cfg = parseCooldownConfig(
      [
        "minimumReleaseAge: 10080",
        "minimumReleaseAgeExclude:",
        "  - hono@4.12.34",
        "blockExoticSubdeps: true",
        "overrides:",
        "  ws: '^8.21.0'",
      ].join("\n")
    );
    expect(cfg.exclude).toEqual(["hono@4.12.34"]);
  });

  it("ignores commented-out settings", () => {
    const cfg = parseCooldownConfig(
      ["# minimumReleaseAge: 1", "minimumReleaseAge: 10080", "#   - ghost@1.0.0"].join("\n")
    );
    expect(cfg.minimumReleaseAgeMinutes).toBe(SEVEN_DAYS_MIN);
    expect(cfg.exclude).toEqual([]);
  });

  // A missing key must not silently default: 0 would make this a plain hard-fail
  // gate again, Infinity would defer every advisory forever.
  it("throws when minimumReleaseAge is absent rather than guessing", () => {
    expect(() => parseCooldownConfig("blockExoticSubdeps: true\n")).toThrow(/minimumReleaseAge/);
  });
});

describe("isExcludedFromCooldown", () => {
  it("matches an exact package@version entry", () => {
    expect(isExcludedFromCooldown("hono", "4.12.34", ["hono@4.12.34"])).toBe(true);
    expect(isExcludedFromCooldown("hono", "4.12.35", ["hono@4.12.34"])).toBe(false);
  });

  it("matches a bare package-name entry", () => {
    expect(isExcludedFromCooldown("hono", "4.13.0", ["hono"])).toBe(true);
  });

  it("does not match an unrelated package", () => {
    expect(isExcludedFromCooldown("fast-uri", "3.1.5", ["hono@4.12.34"])).toBe(false);
  });
});

describe("selectFixedVersion", () => {
  // GHSA-mh99-v99m-4gvg's real shape: one range, introduced at 0, no backports.
  const singleRange = {
    affected: [
      {
        package: { name: "brace-expansion", ecosystem: "npm" },
        ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "5.0.8" }] }],
      },
    ],
  };

  it("handles a single {introduced: 0} → {fixed} range", () => {
    expect(selectFixedVersion(singleRange, "brace-expansion", "5.0.7")).toBe("5.0.8");
  });

  it("returns null when the installed version is already at or past the fix", () => {
    expect(selectFixedVersion(singleRange, "brace-expansion", "5.0.8")).toBeNull();
  });

  // The case that matters: picking the wrong window sends us across a major.
  const backported = {
    affected: [
      {
        package: { name: "fast-uri", ecosystem: "npm" },
        ranges: [
          {
            type: "SEMVER",
            events: [
              { introduced: "2.0.0" },
              { fixed: "2.4.4" },
              { introduced: "3.0.0" },
              { fixed: "3.1.5" },
              { introduced: "4.0.0" },
              { fixed: "4.1.2" },
            ],
          },
        ],
      },
    ],
  };

  it("picks the fix for the installed major, not the first or highest", () => {
    expect(selectFixedVersion(backported, "fast-uri", "3.1.4")).toBe("3.1.5");
    expect(selectFixedVersion(backported, "fast-uri", "2.4.1")).toBe("2.4.4");
    expect(selectFixedVersion(backported, "fast-uri", "4.1.1")).toBe("4.1.2");
  });

  it("returns null for a package the advisory does not name", () => {
    expect(selectFixedVersion(singleRange, "some-other-pkg", "1.0.0")).toBeNull();
  });

  it("returns null when the window has no fix (last_affected only)", () => {
    const noFix = {
      affected: [
        {
          package: { name: "lodash", ecosystem: "npm" },
          ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { last_affected: "4.17.21" }] }],
        },
      ],
    };
    expect(selectFixedVersion(noFix, "lodash", "4.17.21")).toBeNull();
  });

  it("skips GIT ranges, whose events are commit hashes rather than versions", () => {
    const gitRange = {
      affected: [
        {
          package: { name: "pkg", ecosystem: "npm" },
          ranges: [
            { type: "GIT", events: [{ introduced: "abc123" }, { fixed: "def456" }] },
            { type: "SEMVER", events: [{ introduced: "1.0.0" }, { fixed: "1.2.0" }] },
          ],
        },
      ],
    };
    expect(selectFixedVersion(gitRange, "pkg", "1.1.0")).toBe("1.2.0");
  });
});

describe("groupSeverity", () => {
  it("prefers osv-scanner's computed max_severity", () => {
    expect(groupSeverity({ max_severity: "7.5" }, [])).toBe(7.5);
  });

  // An unscored advisory labelled CRITICAL must not be read as 0, or it would
  // slip past the Critical carve-out.
  it("falls back to a CRITICAL label when no score was computed", () => {
    expect(
      groupSeverity({ max_severity: "" }, [{ database_specific: { severity: "CRITICAL" } }])
    ).toBe(CRITICAL_SEVERITY_FLOOR);
  });

  it("reports 0 when severity is genuinely unknown", () => {
    expect(groupSeverity({ max_severity: "" }, [{ database_specific: { severity: "HIGH" } }])).toBe(
      0
    );
  });
});

describe("classifyFinding — the decision table", () => {
  it("DEFERS a High whose fix is still inside the quarantine", () => {
    const r = classify();
    expect(r.verdict).toBe("defer");
    expect(r.unblockAt.toISOString()).toBe("2026-08-06T10:00:00.000Z");
  });

  it("FAILS once the quarantine has elapsed", () => {
    expect(classify({ now: new Date("2026-08-20T00:00:00Z") }).verdict).toBe("fail");
  });

  // The boundary: at exactly publish + window pnpm will install the fix, so
  // there is nothing left to wait for and it must fail, not defer once more.
  it("FAILS at exactly publishedAt + minimumReleaseAge (strict boundary)", () => {
    expect(classify({ now: new Date("2026-08-06T10:00:00Z") }).verdict).toBe("fail");
    expect(classify({ now: new Date("2026-08-06T09:59:59Z") }).verdict).toBe("defer");
  });

  it("FAILS a Critical even deep inside the quarantine", () => {
    const r = classify({ maxSeverity: 9.8, now: new Date("2026-07-30T10:00:01Z") });
    expect(r.verdict).toBe("fail");
    expect(r.reason).toMatch(/Critical/);
  });

  it("DEFERS a High at 8.9, just below the Critical floor", () => {
    expect(classify({ maxSeverity: 8.9 }).verdict).toBe("defer");
  });

  it("FAILS when no fixed version exists — there is nothing to wait for", () => {
    const r = classify({ fixedVersion: null });
    expect(r.verdict).toBe("fail");
    expect(r.reason).toMatch(/nothing to wait for/);
  });

  it("FAILS when the package is already fast-tracked via minimumReleaseAgeExclude", () => {
    const r = classify({ isExcluded: true });
    expect(r.verdict).toBe("fail");
    expect(r.reason).toMatch(/minimumReleaseAgeExclude/);
  });

  // Fail closed: an unknown publish date means we cannot prove the fix is
  // quarantined, so we must not grant a deferral on the strength of a guess.
  it("FAILS when the publish date could not be determined", () => {
    const r = classify({ publishedAt: null });
    expect(r.verdict).toBe("fail");
    expect(r.reason).toMatch(/could not determine/);
  });

  it("respects a different quarantine window", () => {
    // 1 day instead of 7: the same finding is already installable.
    expect(classify({ minimumReleaseAgeMinutes: 1440 }).verdict).toBe("fail");
  });
});

describe("extractFindings", () => {
  // Two OSV records that are aliases of one issue must yield one finding.
  const scan = {
    results: [
      {
        source: { path: "/github/workspace/pnpm-lock.yaml", type: "lockfile" },
        packages: [
          {
            package: { name: "brace-expansion", version: "5.0.8", ecosystem: "npm" },
            vulnerabilities: [
              {
                id: "GHSA-rgw5-rvv9-x895",
                affected: [
                  {
                    package: { name: "brace-expansion", ecosystem: "npm" },
                    ranges: [
                      { type: "SEMVER", events: [{ introduced: "5.0.0" }, { fixed: "5.0.9" }] },
                    ],
                  },
                ],
              },
              {
                id: "CVE-2026-41112",
                affected: [
                  {
                    package: { name: "brace-expansion", ecosystem: "npm" },
                    ranges: [
                      { type: "SEMVER", events: [{ introduced: "5.0.0" }, { fixed: "5.0.9" }] },
                    ],
                  },
                ],
              },
            ],
            groups: [
              {
                ids: ["CVE-2026-41112", "GHSA-rgw5-rvv9-x895"],
                aliases: ["CVE-2026-41112", "GHSA-rgw5-rvv9-x895"],
                max_severity: "7.5",
              },
            ],
          },
        ],
      },
    ],
  };

  it("de-duplicates aliases into a single finding per group", () => {
    const findings = extractFindings(scan);
    expect(findings).toHaveLength(1);
    expect(findings[0].ids).toHaveLength(2);
  });

  it("carries the package, fixed version and severity through", () => {
    const [f] = extractFindings(scan);
    expect(f.name).toBe("brace-expansion");
    expect(f.version).toBe("5.0.8");
    expect(f.fixedVersion).toBe("5.0.9");
    expect(f.maxSeverity).toBe(7.5);
    expect(f.ecosystem).toBe("npm");
  });

  it("returns nothing for a clean scan", () => {
    expect(extractFindings({ results: [] })).toEqual([]);
    expect(extractFindings({})).toEqual([]);
  });

  // Records in one group can disagree about the fix; the higher one satisfies both.
  it("takes the highest fixed version when a group's records disagree", () => {
    const disagreeing = {
      results: [
        {
          packages: [
            {
              package: { name: "p", version: "1.0.0", ecosystem: "npm" },
              vulnerabilities: [
                {
                  id: "A",
                  affected: [
                    {
                      package: { name: "p", ecosystem: "npm" },
                      ranges: [
                        { type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.2.0" }] },
                      ],
                    },
                  ],
                },
                {
                  id: "B",
                  affected: [
                    {
                      package: { name: "p", ecosystem: "npm" },
                      ranges: [
                        { type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.3.0" }] },
                      ],
                    },
                  ],
                },
              ],
              groups: [{ ids: ["A", "B"], max_severity: "5.0" }],
            },
          ],
        },
      ],
    };
    expect(extractFindings(disagreeing)[0].fixedVersion).toBe("1.3.0");
  });
});
