#!/usr/bin/env node

// Cooldown-aware dependency-vulnerability gate.
//
// This wraps `osv-scanner`'s JSON output so the vulnerability gate and the
// supply-chain release-age quarantine stop contradicting each other.
//
// ── The problem this exists to solve ─────────────────────────────────────────
// `pnpm-workspace.yaml` sets `minimumReleaseAge: 10080` (7 days, in minutes),
// mirrored by `cooldown: default-days: 7` in .github/dependabot.yml. pnpm
// refuses to install a version younger than that — including transitive deps —
// because a compromised release is usually caught within days of publish.
//
// A bare `osv-scanner` run fails the instant an advisory is published. For up to
// 7 days it therefore demands a fix the package manager is configured to refuse.
// Across ~1000 locked packages that is a permanent rolling red build, and the
// only escape is a `minimumReleaseAgeExclude` fast-track — which is precisely
// the mechanism the quarantine exists to prevent. A gate that must be bypassed
// by hand every week is a gate nobody reads.
//
// ── What this does instead ───────────────────────────────────────────────────
// For every finding, it asks: is the fixed version old enough for pnpm to
// install it yet?
//   - No  → `::warning::`, deferred, build stays green, and the summary
//           records the exact date the deferral lapses.
//   - Yes → `::error::`, build fails. The fix is installable, so install it.
// The deferral is therefore self-expiring and cannot be forgotten: the moment
// the quarantine lapses this turns red on its own.
//
// Nothing is suppressed indefinitely. An advisory with no fixed version at all
// fails immediately — there is no release to wait for, so deferring would just
// be hiding it.
//
// ── Deliberate carve-out (owner decision, 2026-08-06) ────────────────────────
// CVSS >= CRITICAL_SEVERITY_FLOOR hard-fails regardless of the quarantine. A
// Critical is worth an explicit human call — fast-track it past the quarantine
// with a `minimumReleaseAgeExclude` entry, or accept it in `osv-scanner.toml` —
// but it must never pass silently. High and below are deferrable.
//
// ── Relationship to osv-scanner.toml ─────────────────────────────────────────
// This file handles "the fix exists but is still quarantined". It deliberately
// cannot express "we looked at this and accepted it" — that is what the native
// `[[IgnoredVulns]]` waivers in ./osv-scanner.toml are for (no fix available, or
// not applicable to how we use the package). The two never overlap: osv-scanner
// applies `IgnoredVulns` before emitting JSON, so a waived advisory never
// reaches this script.
//
// ── Fail-closed posture ──────────────────────────────────────────────────────
// If the results file is missing/unparseable, or the npm registry cannot be
// reached, this fails the build. A security gate that goes quiet when it cannot
// verify is worse than one that is occasionally noisy. Those errors are worded
// to make it obvious they are infrastructure failures, not advisories, so nobody
// learns to wave a real finding through.
//
// Mirrors the in-repo guard style (.github/scripts/check-licenses.mjs and
// check-hard-rules.mjs): the decision logic is a set of exported pure functions
// so it is unit-testable without a network or a scanner binary; the file only
// runs `main()` when invoked directly. Tests: tests/unit/check-osv.test.ts.

import { appendFileSync, readFileSync } from "node:fs";

// CVSS base score at or above which a finding hard-fails even while its fix is
// still quarantined. 9.0 is the CVSS v3/v4 floor for Critical. Owner's explicit
// choice (2026-08-06) was "Critical only" — High and below stay deferrable, so
// do not lower this to 7.0 without re-opening that decision.
export const CRITICAL_SEVERITY_FLOOR = 9.0;

// The only ecosystem this gate can reason about: cooldown expiry is derived from
// npm registry publish timestamps. We only ever scan pnpm-lock.yaml, so anything
// else means the workflow's scan target changed and this script needs revisiting.
export const SUPPORTED_ECOSYSTEM = "npm";

// ── Version comparison ───────────────────────────────────────────────────────

/**
 * Compare two semver-ish version strings. Returns <0, 0, or >0.
 *
 * Zero-dep and intentionally simple: numeric segments are compared numerically,
 * and a prerelease (`1.2.3-rc.1`) sorts BELOW its release (`1.2.3`), which is
 * what semver requires. That is the full extent of what this gate needs — it
 * only ever compares versions from a single package's own release line.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareVersions(a, b) {
  const split = (v) => {
    const [core, pre] = String(v).split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const av = split(a);
  const bv = split(b);

  const len = Math.max(av.nums.length, bv.nums.length);
  for (let i = 0; i < len; i++) {
    const diff = (av.nums[i] ?? 0) - (bv.nums[i] ?? 0);
    if (diff !== 0) return diff;
  }

  // Equal cores: a prerelease is lower than the plain release.
  if (av.pre && !bv.pre) return -1;
  if (!av.pre && bv.pre) return 1;
  if (av.pre && bv.pre) return av.pre < bv.pre ? -1 : av.pre > bv.pre ? 1 : 0;
  return 0;
}

// ── pnpm-workspace.yaml ──────────────────────────────────────────────────────

/**
 * Extract the release-age quarantine settings from `pnpm-workspace.yaml`.
 *
 * A targeted line parse rather than a YAML library: this repo has no YAML parser
 * dependency and this gate must stay zero-dep (it runs before `pnpm install`).
 * Only the two top-level keys we need are read, and only in their flat forms —
 * `minimumReleaseAge: <int>` and a `minimumReleaseAgeExclude:` block list.
 *
 * THROWS when `minimumReleaseAge` is absent. A missing key is a config error,
 * not a licence to guess: defaulting to 0 would silently make this gate a plain
 * hard-fail again, and defaulting to Infinity would defer everything forever.
 *
 * @param {string} yamlText
 * @returns {{ minimumReleaseAgeMinutes: number, exclude: string[] }}
 */
export function parseCooldownConfig(yamlText) {
  const lines = String(yamlText).split("\n");

  let minimumReleaseAgeMinutes = null;
  const exclude = [];
  let inExcludeBlock = false;

  for (const line of lines) {
    // Ignore comment-only lines so the commented-out examples in the real file
    // (and its long explanatory header) can never be read as settings.
    if (/^\s*#/.test(line)) continue;

    const age = line.match(/^minimumReleaseAge:\s*(\d+)\s*(?:#.*)?$/);
    if (age) {
      minimumReleaseAgeMinutes = Number.parseInt(age[1], 10);
      inExcludeBlock = false;
      continue;
    }

    if (/^minimumReleaseAgeExclude:\s*(?:#.*)?$/.test(line)) {
      inExcludeBlock = true;
      continue;
    }

    if (inExcludeBlock) {
      const item = line.match(/^\s+-\s*["']?([^"'#\s]+)["']?\s*(?:#.*)?$/);
      if (item) {
        exclude.push(item[1]);
        continue;
      }
      // Any other non-blank line ends the block list.
      if (line.trim() !== "") inExcludeBlock = false;
    }
  }

  if (minimumReleaseAgeMinutes === null) {
    throw new Error(
      "Could not find a top-level `minimumReleaseAge:` in pnpm-workspace.yaml. " +
        "This gate derives its deferral window from that setting, so it cannot run without it. " +
        "If the release-age quarantine was intentionally removed, this gate should be removed too."
    );
  }

  return { minimumReleaseAgeMinutes, exclude };
}

/**
 * Is this package (or this exact package@version) fast-tracked past the
 * quarantine via `minimumReleaseAgeExclude`?
 *
 * If it is, pnpm CAN already install the fix, so there is nothing to wait for
 * and the finding should fail rather than defer.
 *
 * @param {string} name
 * @param {string|null} fixedVersion
 * @param {string[]} exclude
 * @returns {boolean}
 */
export function isExcludedFromCooldown(name, fixedVersion, exclude) {
  return exclude.some((entry) => entry === name || entry === `${name}@${fixedVersion}`);
}

// ── OSV record walking ───────────────────────────────────────────────────────

/**
 * Pick the fixed version relevant to the INSTALLED version of a package.
 *
 * OSV records the affected surface as ordered `introduced`/`fixed` event pairs.
 * An advisory backported across majors has several such windows, and only the
 * one bracketing our installed version tells us what to upgrade to — reading
 * the first or the highest `fixed` would send us across a major boundary.
 *
 * Returns null when the installed version sits in a window with no `fixed`
 * event (i.e. no fix is available on that line).
 *
 * @param {object} vuln — a full OSV record
 * @param {string} packageName
 * @param {string} installedVersion
 * @param {string} [ecosystem]
 * @returns {string|null}
 */
export function selectFixedVersion(
  vuln,
  packageName,
  installedVersion,
  ecosystem = SUPPORTED_ECOSYSTEM
) {
  const affected = Array.isArray(vuln?.affected) ? vuln.affected : [];

  for (const entry of affected) {
    if (entry?.package?.name !== packageName) continue;
    if (entry?.package?.ecosystem && entry.package.ecosystem !== ecosystem) continue;

    for (const range of entry.ranges ?? []) {
      // GIT ranges carry commit hashes, not versions — not comparable here.
      if (range?.type === "GIT") continue;

      let introduced = null;
      for (const event of range.events ?? []) {
        if (event.introduced !== undefined) {
          introduced = event.introduced === "0" ? "0.0.0" : event.introduced;
          continue;
        }
        if (event.fixed !== undefined && introduced !== null) {
          const inWindow =
            compareVersions(installedVersion, introduced) >= 0 &&
            compareVersions(installedVersion, event.fixed) < 0;
          if (inWindow) return event.fixed;
          introduced = null;
        }
        // `last_affected` closes a window with no fix — leave introduced set so
        // a later `fixed` in the same range is still considered.
      }
    }
  }

  return null;
}

/**
 * Highest CVSS base score across a group, preferring osv-scanner's computed
 * `max_severity` and falling back to the advisories' own severity labels.
 *
 * The fallback matters: `max_severity` is an empty string when osv-scanner
 * cannot compute a score, and treating "unknown" as 0 would let a Critical slip
 * past the carve-out. An unscored advisory whose GHSA label says CRITICAL is
 * therefore still treated as Critical.
 *
 * @param {object} group
 * @param {object[]} vulns — the full OSV records in this group
 * @returns {number}
 */
export function groupSeverity(group, vulns = []) {
  const parsed = Number.parseFloat(group?.max_severity);
  if (Number.isFinite(parsed)) return parsed;

  for (const vuln of vulns) {
    const label = String(vuln?.database_specific?.severity ?? "").toUpperCase();
    if (label === "CRITICAL") return CRITICAL_SEVERITY_FLOOR;
  }
  return 0;
}

// ── The decision ─────────────────────────────────────────────────────────────

/**
 * Decide whether a single finding fails the build or is deferred until its fix
 * clears the release-age quarantine.
 *
 * `now` is a PARAMETER, never `Date.now()` — this verdict is wall-clock
 * dependent, so both the tests and any reproduction of an old run need to pin it.
 *
 * @param {object} args
 * @param {string|null} args.fixedVersion
 * @param {Date|null} args.publishedAt — when `fixedVersion` hit the registry
 * @param {number} args.maxSeverity
 * @param {Date} args.now
 * @param {number} args.minimumReleaseAgeMinutes
 * @param {boolean} [args.isExcluded]
 * @returns {{ verdict: "defer"|"fail", reason: string, unblockAt: Date|null }}
 */
export function classifyFinding({
  fixedVersion,
  publishedAt,
  maxSeverity,
  now,
  minimumReleaseAgeMinutes,
  isExcluded = false,
}) {
  if (!fixedVersion) {
    return {
      verdict: "fail",
      reason:
        "no fixed version is available for the installed release line — there is nothing to wait for",
      unblockAt: null,
    };
  }

  if (Number.isFinite(maxSeverity) && maxSeverity >= CRITICAL_SEVERITY_FLOOR) {
    return {
      verdict: "fail",
      reason: `CVSS ${maxSeverity} is Critical, which is never deferred (see CRITICAL_SEVERITY_FLOOR)`,
      unblockAt: null,
    };
  }

  if (isExcluded) {
    return {
      verdict: "fail",
      reason: `${fixedVersion} is listed in minimumReleaseAgeExclude, so pnpm can already install it`,
      unblockAt: null,
    };
  }

  if (!(publishedAt instanceof Date) || Number.isNaN(publishedAt.getTime())) {
    return {
      verdict: "fail",
      reason: `could not determine when ${fixedVersion} was published, so its quarantine status is unknown`,
      unblockAt: null,
    };
  }

  const unblockAt = new Date(publishedAt.getTime() + minimumReleaseAgeMinutes * 60_000);

  // Strict `<`: at exactly the boundary the quarantine has elapsed and pnpm will
  // install the fix, so it fails rather than deferring one more run.
  if (now.getTime() < unblockAt.getTime()) {
    return {
      verdict: "defer",
      reason: `${fixedVersion} is still inside the ${minimumReleaseAgeMinutes}-minute release-age quarantine`,
      unblockAt,
    };
  }

  return {
    verdict: "fail",
    reason: `${fixedVersion} cleared the release-age quarantine on ${unblockAt.toISOString()} and can be installed now`,
    unblockAt,
  };
}

/**
 * Flatten osv-scanner JSON into one finding per alias GROUP per package.
 *
 * Keying off `groups[]` rather than `vulnerabilities[]` is what de-duplicates
 * aliases: osv-scanner already collapses a GHSA and its CVE into one group, so
 * a single issue is reported once instead of two or three times.
 *
 * @param {object} scanResults — parsed osv-scanner `--format=json` output
 * @returns {Array<object>}
 */
export function extractFindings(scanResults) {
  const findings = [];

  for (const result of scanResults?.results ?? []) {
    for (const pkg of result?.packages ?? []) {
      const name = pkg?.package?.name;
      const version = pkg?.package?.version;
      const ecosystem = pkg?.package?.ecosystem;
      if (!name || !version) continue;

      const vulns = Array.isArray(pkg.vulnerabilities) ? pkg.vulnerabilities : [];
      const byId = new Map(vulns.map((v) => [v.id, v]));

      for (const group of pkg.groups ?? []) {
        const ids = Array.isArray(group?.ids) ? group.ids : [];
        if (ids.length === 0) continue;

        const groupVulns = ids.map((id) => byId.get(id)).filter(Boolean);

        // All ids in a group are aliases of ONE issue, so any record that names
        // a fix describes the same fix. Take the highest so a group whose
        // records disagree resolves to the version that satisfies every one.
        let fixedVersion = null;
        for (const vuln of groupVulns) {
          const candidate = selectFixedVersion(vuln, name, version, ecosystem);
          if (candidate && (!fixedVersion || compareVersions(candidate, fixedVersion) > 0)) {
            fixedVersion = candidate;
          }
        }

        findings.push({
          id: ids[0],
          ids,
          name,
          version,
          ecosystem,
          fixedVersion,
          maxSeverity: groupSeverity(group, groupVulns),
          source: result?.source?.path,
        });
      }
    }
  }

  return findings;
}

// ── I/O ──────────────────────────────────────────────────────────────────────

/**
 * Look up when a specific version of an npm package was published.
 * Memoised per package: one advisory group can ask about several versions.
 */
const packumentCache = new Map();

async function fetchPackument(name) {
  if (packumentCache.has(name)) return packumentCache.get(name);

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`registry responded ${res.status} ${res.statusText}`);
      const body = await res.json();
      packumentCache.set(name, body);
      return body;
    } catch (err) {
      lastErr = err;
      // 250ms, 500ms — short enough not to stall CI, enough to ride out a blip.
      // No sleep after the final attempt; we're about to throw.
      if (attempt < 2) await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    }
  }
  throw new Error(
    `Could not reach registry.npmjs.org for "${name}": ${lastErr?.message ?? lastErr}`
  );
}

export async function fetchPublishTime(name, version) {
  const packument = await fetchPackument(name);
  const stamp = packument?.time?.[version];
  return stamp ? new Date(stamp) : null;
}

function summaryLine(text) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    appendFileSync(path, `${text}\n`);
  } catch {
    /* a summary is a nicety; never fail the gate over it */
  }
}

async function main() {
  const resultsPath = process.argv[2] ?? "osv-results.json";

  let scanResults;
  try {
    scanResults = JSON.parse(readFileSync(resultsPath, "utf8"));
  } catch (err) {
    console.error(
      `::error::osv-scanner produced no readable results at "${resultsPath}". This is an INFRASTRUCTURE failure of the scan step, not a vulnerability — check the osv-scanner step's log above. Failing closed.`
    );
    console.error(err?.message ?? err);
    process.exit(2);
  }

  let cooldown;
  try {
    cooldown = parseCooldownConfig(readFileSync("pnpm-workspace.yaml", "utf8"));
  } catch (err) {
    console.error(`::error::${err?.message ?? err}`);
    process.exit(2);
  }

  const findings = extractFindings(scanResults);
  if (findings.length === 0) {
    console.log("✓ osv-scanner found no known vulnerabilities in pnpm-lock.yaml.");
    return;
  }

  const now = new Date();
  const deferred = [];
  const failures = [];

  for (const finding of findings) {
    if (finding.ecosystem && finding.ecosystem !== SUPPORTED_ECOSYSTEM) {
      failures.push({
        ...finding,
        reason: `ecosystem "${finding.ecosystem}" is not npm, so this gate cannot check its release age`,
      });
      continue;
    }

    let publishedAt = null;
    if (finding.fixedVersion) {
      try {
        publishedAt = await fetchPublishTime(finding.name, finding.fixedVersion);
      } catch (err) {
        console.error(
          `::error::Could not reach the npm registry to check whether ${finding.name}@${finding.fixedVersion} has cleared the release-age quarantine. This is an INFRASTRUCTURE failure, not a vulnerability. Failing closed.`
        );
        console.error(err?.message ?? err);
        process.exit(2);
      }
    }

    const verdict = classifyFinding({
      fixedVersion: finding.fixedVersion,
      publishedAt,
      maxSeverity: finding.maxSeverity,
      now,
      minimumReleaseAgeMinutes: cooldown.minimumReleaseAgeMinutes,
      isExcluded: isExcludedFromCooldown(finding.name, finding.fixedVersion, cooldown.exclude),
    });

    (verdict.verdict === "defer" ? deferred : failures).push({ ...finding, ...verdict });
  }

  if (deferred.length > 0) {
    summaryLine("### Deferred vulnerability findings\n");
    summaryLine(
      "These advisories have a fix, but it is still inside the `minimumReleaseAge` quarantine in `pnpm-workspace.yaml`, so pnpm cannot install it yet. Each becomes a hard failure on its unblock date.\n"
    );
    summaryLine("| Advisory | Package | Installed | Fixed in | CVSS | Unblocks |");
    summaryLine("| --- | --- | --- | --- | --- | --- |");
  }
  for (const d of deferred) {
    console.log(
      `::warning::${d.id}: ${d.name}@${d.version} — fix ${d.fixedVersion} is still in the release-age quarantine; deferred until ${d.unblockAt.toISOString()}. This will fail the build automatically after that date.`
    );
    summaryLine(
      `| [${d.id}](https://osv.dev/${d.id}) | \`${d.name}\` | ${d.version} | ${d.fixedVersion} | ${d.maxSeverity || "—"} | ${d.unblockAt.toISOString().slice(0, 16).replace("T", " ")} UTC |`
    );
  }

  for (const f of failures) {
    console.log(
      `::error::${f.id}: ${f.name}@${f.version} (CVSS ${f.maxSeverity || "unknown"}) — ${f.reason}. Fix: ${
        f.fixedVersion
          ? `raise ${f.name} to ${f.fixedVersion} (check pnpm-workspace.yaml \`overrides\` — it may be pinned there).`
          : "no fix is published yet; if this advisory does not apply to how we use the package, record a reviewed waiver in osv-scanner.toml."
      }`
    );
  }

  if (failures.length > 0) {
    console.error(
      `\n${failures.length} actionable vulnerability finding(s); ${deferred.length} deferred pending release-age quarantine.`
    );
    process.exit(1);
  }

  console.log(
    `✓ ${deferred.length} vulnerability finding(s), all with fixes still inside the ${cooldown.minimumReleaseAgeMinutes}-minute release-age quarantine. Deferred — see the job summary for unblock dates.`
  );
}

// Only run when invoked directly (not when imported by the unit tests).
if (process.argv[1]?.endsWith("check-osv.mjs")) {
  await main();
}
