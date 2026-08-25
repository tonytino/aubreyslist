#!/usr/bin/env node

// Owner-review detector — Layer 2 of the guardrail (ADR-015, docs/agents/governance.md).
// Called by the `owner-review` job in .github/workflows/pr-conventions.yml.
//
// Fails the PR when it touches an owner-gated surface but is not labeled
// `safe:human` — i.e. an agent tried to self-classify a cost/legal/security/
// trust-safety/data-loss/privacy/disclaimer change as `safe:agent`
// (auto-mergeable). The gated surface = the paths in owner-review-paths.mjs
// (mirrored in .github/CODEOWNERS) plus content signals paths can't see
// (destructive SQL, disclaimer copy, telemetry posture).
//
// A forcing function + fast feedback, not the enforcement: branch protection +
// CODEOWNERS (Layer 1) is what makes an owned-path PR unmergeable without the
// owner. There is no bypass label: the only way past a gated change is the
// owner's own GitHub review.
//
// The matching logic is exported pure functions so it is unit-testable without
// git or the filesystem (mirrors .github/scripts/check-hard-rules.mjs). Tests:
// tests/unit/check-owner-review.test.ts. The PR labels/diff are read from env
// in main() — never inline argv — so a hostile branch name / label can't
// inject.

import { execFileSync } from "node:child_process";
import { CONTENT_CHECKS, OWNED_PATHS, OWNER_HANDLE, OWNER_LABEL } from "./owner-review-paths.mjs";

/**
 * Does `file` (a repo-relative POSIX path, no leading slash) match the CODEOWNERS
 * glob `pattern` (a token from OWNED_PATHS, leading `/` = root-anchored)?
 * Implements the subset of gitignore/CODEOWNERS semantics this repo uses:
 *   - trailing `/` → directory prefix (matches everything under it);
 *   - `*` → any run of non-`/`; `?` → one non-`/`;
 *   - all other chars literal (`.`, `$`, … are not regex metacharacters here).
 *
 * @param {string} pattern
 * @param {string} file
 * @returns {boolean}
 */
export function matchCodeowners(pattern, file) {
  if (typeof pattern !== "string" || typeof file !== "string") return false;
  // Every OWNED_PATHS entry is root-anchored with a leading slash; strip it.
  const pat = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  const f = file.startsWith("/") ? file.slice(1) : file;

  // Directory prefix: `dir/` matches `dir/...anything`.
  if (pat.endsWith("/")) return f === pat.slice(0, -1) || f.startsWith(pat);

  // File / wildcard pattern: build an anchored regex where `*`/`?` do not cross
  // `/` and every other character is literal.
  let re = "";
  for (const ch of pat) {
    if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`).test(f);
}

/** Is `file` matched by any owner-gated path? */
export function isOwnedPath(file) {
  return OWNED_PATHS.some((p) => matchCodeowners(p, file));
}

/**
 * Parse a unified diff (as from `git diff --unified=0`) into per-line change
 * entries. Returns [{ file, side: "add" | "del", text }]. Diff/hunk headers are
 * skipped; the file is taken from the `+++ b/<path>` header (falling back to
 * `--- a/<path>` when the new side is /dev/null, i.e. a deletion).
 *
 * @param {string} diffText
 * @returns {{ file: string, side: "add" | "del", text: string }[]}
 */
export function parseUnifiedDiff(diffText) {
  const out = [];
  if (typeof diffText !== "string" || diffText === "") return out;
  let aPath = null;
  let file = null;
  // Track hunk state so a content line that happens to start with `+++ ` /
  // `--- ` (e.g. `+++ heading` inside an edited markdown/SQL body) is not
  // misparsed as a file header. `--- `/`+++ ` are headers only before the
  // first `@@` of a file; once inside a hunk, `+`/`-` lines are content until
  // the next `diff --git`.
  let inHunk = false;
  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("diff --git")) {
      file = null;
      aPath = null;
      inHunk = false;
      continue;
    }
    if (!inHunk && line.startsWith("--- ")) {
      const p = line.slice(4).trim();
      aPath = p === "/dev/null" ? null : p.replace(/^a\//, "");
      continue;
    }
    if (!inHunk && line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      file = p === "/dev/null" ? aPath : p.replace(/^b\//, "");
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk || !file) continue;
    if (line.startsWith("+")) out.push({ file, side: "add", text: line.slice(1) });
    else if (line.startsWith("-")) out.push({ file, side: "del", text: line.slice(1) });
  }
  return out;
}

/** Run the CONTENT_CHECKS over parsed diff entries; return matched reasons. */
export function contentReasons(entries) {
  const reasons = [];
  for (const check of CONTENT_CHECKS) {
    for (const e of entries) {
      const sideOk = check.side === "both" || e.side === "add";
      if (!sideOk) continue;
      if (check.fileScope && !check.fileScope.test(e.file)) continue;
      if (check.patterns.some((re) => re.test(e.text))) {
        reasons.push({ kind: check.kind, file: e.file, detail: check.message });
      }
    }
  }
  return reasons;
}

/**
 * Classify a PR. Pure — takes already-collected inputs so it is unit-testable.
 *
 * @param {{ changedFiles?: string[], diffText?: string, labels?: string[] }} input
 * @returns {{ requiresOwner: boolean, ok: boolean, hasOwnerLabel: boolean,
 *            reasons: { kind: string, file?: string, detail?: string }[] }}
 */
export function classifyOwnerReview({ changedFiles = [], diffText = "", labels = [] } = {}) {
  const reasons = [];

  // Path-based (mirrors CODEOWNERS / Layer 1).
  for (const file of changedFiles) {
    if (isOwnedPath(file)) {
      reasons.push({
        kind: "path",
        file,
        detail: "Changes an owner-gated path (see .github/CODEOWNERS).",
      });
    }
  }

  // Content-based (catches gated changes in files paths can't see).
  reasons.push(...contentReasons(parseUnifiedDiff(diffText)));

  const requiresOwner = reasons.length > 0;
  const hasOwnerLabel = labels.includes(OWNER_LABEL);
  return { requiresOwner, ok: !requiresOwner || hasOwnerLabel, hasOwnerLabel, reasons };
}

// ── main() — gather inputs from env/git and enforce ──────────────────────────

/** Split a newline/comma-delimited env value into a clean array. */
function splitList(value) {
  return (value ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Collect changed files + unified diff, from env overrides or git vs the PR base. */
function collectDiff() {
  // Test/manual override: pass OWNER_REVIEW_FILES (newline list) and optional
  // OWNER_REVIEW_DIFF (unified patch) to run without a real branch.
  if (process.env.OWNER_REVIEW_FILES !== undefined) {
    return {
      changedFiles: splitList(process.env.OWNER_REVIEW_FILES),
      diffText: process.env.OWNER_REVIEW_DIFF ?? "",
    };
  }
  // CI path: diff against the merge-base with the PR base (BASE_SHA on
  // pull_request events; falls back to origin/main).
  const baseRef = process.env.BASE_SHA || "origin/main";
  let base;
  try {
    base = execFileSync("git", ["merge-base", baseRef, "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    base = baseRef;
  }
  // `-c core.quotepath=false` so non-ASCII filenames come back verbatim (not
  // C-quoted like "app/caf\303\251.ts"), which would otherwise defeat the
  // path and header matching. Diffing from the merge-base is
  // three-dot-equivalent scoping (only this branch's own changes).
  const changedFiles = splitList(
    execFileSync("git", ["-c", "core.quotepath=false", "diff", "--name-only", `${base}`, "HEAD"], {
      encoding: "utf8",
    })
  );
  const diffText = execFileSync(
    "git",
    ["-c", "core.quotepath=false", "diff", "--unified=0", `${base}`, "HEAD"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  return { changedFiles, diffText };
}

function main() {
  const labels = splitList(process.env.OWNER_REVIEW_LABELS);
  const { changedFiles, diffText } = collectDiff();
  const result = classifyOwnerReview({ changedFiles, diffText, labels });

  if (result.ok) {
    if (result.requiresOwner) {
      console.log(
        `✓ Owner-gated change is correctly labeled \`${OWNER_LABEL}\` — ${OWNER_HANDLE} reviews and merges it (a human clicks merge; agents never do).`
      );
    } else {
      console.log("✓ No owner-gated surface touched — this PR can ship without owner review.");
    }
    process.exit(0);
  }

  // Fail: gated surface touched without safe:human. Emit one annotation per
  // distinct reason kind (with an example file) so the author sees why.
  const seen = new Set();
  for (const r of result.reasons) {
    const key = `${r.kind}:${r.file ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const where = r.file ? ` (${r.file})` : "";
    console.log(`::error::[owner-review:${r.kind}]${where} ${r.detail ?? ""}`);
  }
  console.error(
    `\nThis PR touches an owner-gated surface (cost / legal / security / trust & safety / ` +
      `data-loss / privacy / safety-disclaimer). Relabel it \`${OWNER_LABEL}\` (never \`safe:agent\`): ` +
      `only ${OWNER_HANDLE} can approve and merge it, a human clicks merge, and there is NO bypass label. ` +
      `See docs/agents/governance.md.`
  );
  process.exit(1);
}

// Only run when invoked directly (not when imported by the unit tests).
if (process.argv[1]?.endsWith("check-owner-review.mjs")) {
  main();
}
