#!/usr/bin/env node

// License allowlist gate (issue #190). Zero-dependency: it shells out to the
// package manager already in the repo (`pnpm licenses list --json`), parses the
// result, and FAILS if any installed dependency carries a license that is not on
// an explicit permissive allowlist (and is not a package-scoped, documented
// exception). Copyleft / unknown licenses are surfaced as GitHub `::error::`
// annotations naming the offending package + license for human review.
//
// Mirrors the in-repo guard style (.github/scripts/check-hard-rules.mjs and
// check-changelog-tags.mjs): the matching predicate is an exported PURE function
// (`isAllowedLicense`) so it is unit-testable without spawning pnpm; the file
// only runs `main()` when invoked directly. Tests: tests/unit/check-licenses.test.ts.
//
// ── How to EXTEND the allowlist ──────────────────────────────────────────────
//   1. A new PERMISSIVE SPDX id (e.g. you adopt a dep under `Zlib`): add the
//      exact SPDX identifier to the ALLOWLIST set below. Keep it permissive-only
//      — do NOT add copyleft ids (GPL/LGPL/AGPL) or weak-copyleft (MPL, EPL,
//      CDDL) here. Those belong in REVIEWED_EXCEPTIONS, package-scoped, with a
//      written rationale, after a human OKs them.
//   2. A specific PACKAGE under a non-allowlisted license that a human has
//      reviewed and accepted (e.g. a weak-copyleft transitive build tool): add a
//      `{ name, license, reason }` entry to REVIEWED_EXCEPTIONS. This is
//      deliberately package-scoped (not license-scoped) so accepting one MPL
//      build tool does not silently wave through every future MPL dependency.
//
// ── SPDX expression handling ─────────────────────────────────────────────────
//   pnpm reports SPDX *expressions*, not just bare ids — e.g. "MIT OR Apache-2.0"
//   or "(BSD-3-Clause OR GPL-2.0)". `isAllowedLicense` parses the boolean form:
//     - "A OR B" is allowed if EITHER side is allowed (the consumer may pick the
//       permissive side — this is why node-forge's "(BSD-3-Clause OR GPL-2.0)"
//       passes: we choose BSD-3-Clause).
//     - "A AND B" is allowed only if BOTH sides are allowed (you must comply with
//       every listed license).
//   Parentheses and arbitrary nesting are supported. `WITH <exception>` clauses
//   are stripped (the exception narrows the grant, it doesn't change the family).

import { execFileSync } from "node:child_process";

// ── The permissive allowlist (exact SPDX ids; matched case-insensitively) ────
// Kept intentionally small and permissive-only. SEE "How to EXTEND" above.
export const ALLOWLIST = new Set(
  [
    "MIT",
    "MIT-0",
    "ISC",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "0BSD",
    "CC0-1.0",
    "Unlicense",
    "Python-2.0",
    "BlueOak-1.0.0",
    "CC-BY-4.0",
    "WTFPL",
    "Zlib",
  ].map((s) => s.toLowerCase())
);

// ── Reviewed, package-scoped exceptions ──────────────────────────────────────
// Each entry is a SPECIFIC package whose (non-allowlisted) license a human has
// reviewed and accepted, with the rationale recorded here. This list is the
// audit trail for "we looked at this and decided it's fine". Adding a package
// here is the human decision the allowlist deliberately refuses to make on its
// own. Match is by package name AND its reported license string.
export const REVIEWED_EXCEPTIONS = [
  {
    name: "lightningcss",
    license: "MPL-2.0",
    reason:
      "Weak (file-level) copyleft. Transitive *build-time* peer dep of vite (via TanStack Start / vinxi); never shipped in the app bundle and not modified by us, so the MPL's per-file source-sharing obligation is not triggered. Reviewed for #190.",
  },
  {
    name: "lightningcss-linux-x64-gnu",
    license: "MPL-2.0",
    reason:
      "Platform-specific native binary for lightningcss (same MPL-2.0 review as lightningcss).",
  },
  {
    name: "lightningcss-linux-x64-musl",
    license: "MPL-2.0",
    reason:
      "Platform-specific native binary for lightningcss (same MPL-2.0 review as lightningcss).",
  },
  {
    name: "axe-core",
    license: "MPL-2.0",
    reason:
      "Weak (file-level) copyleft. dev/test-time only — the accessibility engine driven by @axe-core/playwright in the a11y test lane (#192); never imported by app code, never shipped in the client or server bundle, and not modified by us, so the MPL's per-file source-sharing obligation is not triggered (same rationale as lightningcss). Reviewed for #195.",
  },
  {
    name: "@axe-core/playwright",
    license: "MPL-2.0",
    reason:
      "Playwright binding for axe-core (same MPL-2.0 review as axe-core): dev/test-time only, never shipped in the app bundle. Reviewed for #195.",
  },
  {
    name: "@sentry/cli",
    license: "FSL-1.1-MIT",
    reason:
      "Functional Source License (delayed open source): converts to MIT after 2 years and only restricts building a competing product, which we don't. Build-time-only transitive dep of @sentry/tanstackstart-react — it uploads source maps at build (AUB-106) and is never shipped in the client or server bundle. Same build-tool rationale as the lightningcss exception. Reviewed for AUB-110.",
  },
  // Platform-specific native binaries for @sentry/cli (same FSL-1.1-MIT review):
  // pnpm installs only the current platform's optional dep, so which one appears
  // depends on the machine — @sentry/cli-linux-x64 on the CI runner,
  // @sentry/cli-darwin on local Macs, etc. All are build-time-only and never
  // shipped in the app bundle.
  {
    name: "@sentry/cli-linux-x64",
    license: "FSL-1.1-MIT",
    reason: "Native @sentry/cli binary (Linux x64, e.g. the CI runner). See @sentry/cli.",
  },
  {
    name: "@sentry/cli-linux-arm64",
    license: "FSL-1.1-MIT",
    reason: "Native @sentry/cli binary (Linux arm64). See @sentry/cli.",
  },
  {
    name: "@sentry/cli-darwin",
    license: "FSL-1.1-MIT",
    reason: "Native @sentry/cli binary (macOS, local dev). See @sentry/cli.",
  },
  {
    name: "@sentry/cli-win32-x64",
    license: "FSL-1.1-MIT",
    reason: "Native @sentry/cli binary (Windows x64). See @sentry/cli.",
  },
];

/**
 * Tokenize a SPDX expression into ids, the operators AND/OR, and parens.
 * e.g. "(BSD-3-Clause OR GPL-2.0)" -> ["(", "BSD-3-Clause", "OR", "GPL-2.0", ")"].
 * A bare/empty/unknown license string yields a single token (often "UNKNOWN").
 */
function tokenizeSpdx(expr) {
  return expr.replace(/\(/g, " ( ").replace(/\)/g, " ) ").split(/\s+/).filter(Boolean);
}

/**
 * Pure predicate: is `spdx` an allowed license expression given `allowlist`
 * (a Set of lowercased SPDX ids)? Handles OR (either side suffices), AND (both
 * sides required), parentheses, and `WITH <exception>` (the exception token is
 * dropped — it narrows, not broadens, the grant). Comparison is case-insensitive.
 * An unparseable, empty, or "UNKNOWN" string is NOT allowed (fail closed).
 *
 * Recursive-descent over: expr := term (OR term)* ; term := factor (AND factor)* ;
 * factor := "(" expr ")" | <spdx-id>.
 */
export function isAllowedLicense(spdx, allowlist = ALLOWLIST) {
  if (typeof spdx !== "string") return false;
  const trimmed = spdx.trim();
  if (trimmed === "" || /^unknown$/i.test(trimmed)) return false;

  const tokens = tokenizeSpdx(trimmed);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr() {
    let value = parseTerm();
    while (peek() && peek().toUpperCase() === "OR") {
      next();
      const right = parseTerm();
      value = value || right; // OR: either operand permissive is enough.
    }
    return value;
  }

  function parseTerm() {
    let value = parseFactor();
    while (peek() && peek().toUpperCase() === "AND") {
      next();
      const right = parseFactor();
      value = value && right; // AND: every operand must be permissive.
    }
    return value;
  }

  function parseFactor() {
    const tok = next();
    let value;
    if (tok === "(") {
      value = parseExpr();
      if (peek() === ")") next(); // consume the matching ")"
    } else {
      value = allowlist.has(String(tok).toLowerCase());
    }
    // A trailing `WITH <exception>` clause (e.g. "Apache-2.0 WITH LLVM-exception")
    // narrows the grant; it does not change the license family. Consume the
    // `WITH` and its exception id and judge by the base factor we already parsed.
    if (peek() && peek().toUpperCase() === "WITH") {
      next(); // WITH
      if (peek()) next(); // exception id
    }
    return value;
  }

  const result = parseExpr();
  // Reject trailing garbage (malformed expression) -> fail closed.
  if (pos !== tokens.length) return false;
  return result;
}

/** Is this specific package+license a reviewed, accepted exception? */
export function isReviewedException(name, license, exceptions = REVIEWED_EXCEPTIONS) {
  return exceptions.some((e) => e.name === name && e.license === license);
}

/**
 * Given the parsed `pnpm licenses list --json` object (keys = SPDX strings,
 * values = arrays of { name, versions, license, ... }), return the list of
 * violations: { name, version, license }. Pure — takes the already-parsed data
 * so it is unit-testable without spawning pnpm.
 */
export function findViolations(
  data,
  { allowlist = ALLOWLIST, exceptions = REVIEWED_EXCEPTIONS } = {}
) {
  const violations = [];
  for (const [licenseKey, pkgs] of Object.entries(data ?? {})) {
    if (isAllowedLicense(licenseKey, allowlist)) continue;
    for (const pkg of pkgs ?? []) {
      // Prefer the per-package `license` field when present; fall back to the
      // grouping key (they are normally identical).
      const license = pkg.license || licenseKey;
      if (isAllowedLicense(license, allowlist)) continue;
      if (isReviewedException(pkg.name, license, exceptions)) continue;
      const version = Array.isArray(pkg.versions) ? pkg.versions.join(", ") : (pkg.version ?? "?");
      violations.push({ name: pkg.name, version, license });
    }
  }
  // Stable, deterministic ordering for legible output.
  violations.sort((a, b) => a.name.localeCompare(b.name) || a.license.localeCompare(b.license));
  return violations;
}

function main() {
  let raw;
  try {
    raw = execFileSync("pnpm", ["licenses", "list", "--json"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (err) {
    console.error(
      "::error::Failed to run `pnpm licenses list --json`. Are dependencies installed?"
    );
    console.error(err?.message ?? err);
    process.exit(2);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error("::error::Could not parse `pnpm licenses list --json` output as JSON.");
    console.error(err?.message ?? err);
    process.exit(2);
  }

  const violations = findViolations(data);

  if (violations.length > 0) {
    for (const v of violations) {
      console.log(
        `::error::Disallowed license "${v.license}" for package "${v.name}@${v.version}". It is not on the permissive allowlist in .github/scripts/check-licenses.mjs. If this is acceptable, a human must add it to ALLOWLIST (permissive SPDX id) or REVIEWED_EXCEPTIONS (package-scoped, with a rationale) — see the header in that file.`
      );
    }
    console.error(
      `\n${violations.length} dependency license(s) outside the allowlist. Review each above and extend the allowlist deliberately (see check-licenses.mjs header).`
    );
    process.exit(1);
  }

  console.log(
    "✓ All dependency licenses are on the permissive allowlist (or reviewed exceptions)."
  );
}

// Only run when invoked directly (not when imported by the unit tests).
if (process.argv[1]?.endsWith("check-licenses.mjs")) {
  main();
}
