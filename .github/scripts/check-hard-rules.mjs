#!/usr/bin/env node

// Encodes the AGENTS.md "Hard Rules" (issue #179) as a deterministic, zero-dep
// static guard so a violation cannot be merged. The script walks the repo with
// node:fs, runs each rule's pure matcher over the in-scope files, collects EVERY
// violation (no fail-fast), prints each as a GitHub `::error::` annotation with
// `file:line` + a one-line remedy, and exits 1 if any were found (0 if clean).
//
// The matching logic lives in exported pure functions (content + path -> array
// of { line, message }) so it is unit-testable without touching the filesystem.
// Tests live in tests/unit/hard-rules-guard.test.ts (Vitest's include globs do
// not cover .github/**, so the test file lives where Vitest discovers it).
//
// Mirrors the in-repo guard style (.github/scripts/check-changelog-tags.mjs and
// the "Assert the client bundle contains no db/neon code" ci.yml step).
//
// KNOWN LIMITATIONS (deliberate heuristic limits — kept simple on purpose; the
// authoritative backstops are the #159 client-bundle build guard and Vitest's
// CI `allowOnly=false`, not this fast static pass):
//   - The matchers are line-text based and do NOT strip comments or string
//     literals (intentionally — stripping is complex and risky). So a
//     `process.env` token (rule #1) or a `.only(`/`.skip("`/`.todo(` token
//     (rule #5) that appears inside a comment or a string literal can self-flag.
//   - As a corollary of the above, rule #5 self-flags literal trigger tokens
//     that appear as data in a test file (the guard's own test assembles those
//     tokens at runtime to avoid this).
//   - Rules #3/#4 scope "client surface" to the fast early-warning subset
//     `app/components/` + `app/routes/` (minus server seams). The AUTHORITATIVE
//     backstop for db/neon leaking into the browser is the #159 build-bundle
//     grep, which asserts the real client output. Raw-fetch detection (rule #4)
//     only matches when the `/api` URL literal sits on the SAME line as
//     `fetch(`.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

// Repo root: this file is at <root>/.github/scripts/check-hard-rules.mjs.
const ROOT = join(import.meta.dirname, "..", "..");

// ---------------------------------------------------------------------------
// Path helpers (operate on repo-relative POSIX paths so rules are OS-agnostic).
// ---------------------------------------------------------------------------

/** Normalize a path to repo-relative POSIX form (forward slashes). */
export function toPosix(path) {
  return path.split(sep).join(posix.sep);
}

const isTestFile = (p) => /\.test\.tsx?$/.test(p);
const isFnSeam = (p) => /\.fn\.tsx?$/.test(p);
const isServerSeam = (p) =>
  isFnSeam(p) ||
  /\.server\.tsx?$/.test(p) ||
  p.startsWith("app/server/") ||
  p.startsWith("db/") ||
  // The Hono API route forwards every request to the server app; it is a
  // server seam even though it lives under app/routes/.
  p === "app/routes/api.$.ts";

/**
 * Client-surface files for rules #3 (db imports) and #4 (raw fetch to /api).
 * Conservatively scoped to the code that ships to the browser: components and
 * routes, MINUS the server seams that legitimately reach the database/API
 * (`*.fn.ts`, `*.server.ts`, and `app/routes/api.$.ts`). Test files are
 * excluded — they assert against db/fetch behavior and are not shipped.
 */
export function isClientSurface(path) {
  const p = toPosix(path);
  if (isTestFile(p) || isServerSeam(p)) return false;
  return p.startsWith("app/components/") || p.startsWith("app/routes/");
}

// ---------------------------------------------------------------------------
// Rule matchers. Each takes (content, path) and returns [{ line, message }].
// `path` is a repo-relative POSIX path. Callers decide which files to feed in,
// but every matcher also re-checks its own scope so it is safe to unit-test in
// isolation and impossible to mis-wire.
// ---------------------------------------------------------------------------

/** Iterate lines as 1-based [lineNumber, text] pairs. */
function* lines(content) {
  const split = content.split(/\r?\n/);
  for (let i = 0; i < split.length; i++) yield [i + 1, split[i]];
}

/**
 * Rule #1: No `process.env` outside app/env.ts.
 * Scope: app/**\/*.{ts,tsx}, EXCLUDING app/env.ts and test files. Build tooling
 * (vite.config.ts, scripts/**, .github/**, vitest/playwright config) is out of
 * scope — only app/ runtime code.
 */
export function checkProcessEnv(content, path) {
  const p = toPosix(path);
  const inScope = p.startsWith("app/") && /\.tsx?$/.test(p) && p !== "app/env.ts" && !isTestFile(p);
  if (!inScope) return [];
  const out = [];
  for (const [n, text] of lines(content)) {
    if (/process\.env\b/.test(text)) {
      out.push({
        line: n,
        message:
          "`process.env` is only allowed in app/env.ts. Route this through the Zod-validated getEnv() accessor (docs/agents/environment.md).",
      });
    }
  }
  return out;
}

/**
 * Rule #2: No `@ts-ignore` / `@ts-expect-error` without an explanatory comment.
 * Scope: app/**, db/**, scripts/**, tests/** .ts/.tsx files. A directive with a
 * trailing explanation on the same line is OK; the bare directive is a
 * violation.
 */
export function checkTsDirective(content, path) {
  const p = toPosix(path);
  const inScope =
    /\.tsx?$/.test(p) &&
    (p.startsWith("app/") ||
      p.startsWith("db/") ||
      p.startsWith("scripts/") ||
      p.startsWith("tests/"));
  if (!inScope) return [];
  const out = [];
  // Capture everything the directive carries after its name on the same line.
  const re = /@ts-(?:ignore|expect-error)\b(.*)$/;
  for (const [n, text] of lines(content)) {
    const m = text.match(re);
    if (!m) continue;
    // Trailing text after the directive, stripped of comment punctuation, must
    // contain a real explanation. `// @ts-expect-error` and `// @ts-expect-error --`
    // are violations; `// @ts-expect-error reason here` is OK.
    const trailing = m[1].replace(/[-—:\s*]/g, "");
    if (trailing.length === 0) {
      out.push({
        line: n,
        message:
          "Add an explanation after the @ts-ignore / @ts-expect-error directive (e.g. `// @ts-expect-error <why>`). Bare suppressions are not allowed.",
      });
    }
  }
  return out;
}

/**
 * Rule #3: No `db` imports in client-side code.
 * Flags VALUE imports of ~/db, ~/db/..., drizzle-orm, or @neondatabase/serverless
 * in client-surface files. `import type { ... } from "~/db/schema"` is erased at
 * compile time and is explicitly allowed (the repo relies on it — e.g.
 * ListingCard.tsx imports the `Listing` type). Caller must pre-filter to client
 * surface; this matcher does NOT re-derive scope because "client surface"
 * depends on the file tree, but it is a no-op on non-matching content.
 */
export function checkClientDbImport(content, path) {
  if (!isClientSurface(path)) return [];
  const out = [];
  // Match a static import whose specifier is a db/orm/neon module. We then
  // require it to NOT be a type-only import (`import type ...` or
  // `import { type X }` — the latter still pulls a value binding only if a
  // non-type binding is present, so we treat a whole-line `import type` as safe
  // and flag any value `import ... from "<db>"`).
  const dbSpecifier =
    /from\s+["'](~\/db(?:\/[^"']*)?|drizzle-orm[^"']*|@neondatabase\/serverless)["']/;
  for (const [n, text] of lines(content)) {
    if (!dbSpecifier.test(text)) continue;
    // Allow type-only imports: `import type { ... } from "..."`.
    if (/^\s*import\s+type\b/.test(text)) continue;
    // Also allow `export type { ... } from "..."` re-exports of types.
    if (/^\s*export\s+type\b/.test(text)) continue;
    out.push({
      line: n,
      message:
        "Client code must not import the database (~/db, drizzle-orm, @neondatabase/serverless) as a value. Move the access behind a *.fn.ts server function, or use `import type` for types only.",
    });
  }
  return out;
}

/**
 * Rule #4: No raw `fetch` against Hono routes from the frontend.
 * Flags a `fetch(` call whose URL argument references `/api` in client-surface
 * files. The repo uses an RPC client / server functions instead. A method call
 * like `app.fetch(request)` (the Hono handoff) is not a bare `fetch(` and is not
 * flagged; api.$.ts is a server seam anyway.
 */
export function checkRawApiFetch(content, path) {
  if (!isClientSurface(path)) return [];
  const out = [];
  for (const [n, text] of lines(content)) {
    // Bare global fetch( — not preceded by `.` (which would be `x.fetch(`).
    // Require the same line to reference an /api path so we only flag calls
    // hitting the Hono routes, not unrelated fetches.
    if (/(?<![.\w])fetch\s*\(/.test(text) && /["'`][^"'`]*\/api\b/.test(text)) {
      out.push({
        line: n,
        message:
          "Do not call the Hono /api routes with raw fetch() from the frontend. Use the RPC client / a server function (docs/agents/api.md).",
      });
    }
  }
  return out;
}

/**
 * Rule #5: Test honesty. Flags focused (`.only`) and disabled (`.skip` modifier,
 * `.todo`) tests in test files. Scope: **\/*.test.{ts,tsx} and tests/**.
 *
 * IMPORTANT: the conditional-skip APIs are legitimate and must NOT be flagged:
 *   - `test.skip(!cond, "reason")` — Playwright runtime skip (first arg is an
 *     expression, not a string-literal test name).
 *   - `describe.skipIf(cond)(...)` — Vitest conditional describe (`.skipIf`, not
 *     `.skip`).
 * We therefore flag the `.skip(` MODIFIER form only when its first argument is a
 * string literal (a test name): `it.skip("name", ...)`.
 */
export function checkTestHonesty(content, path) {
  const p = toPosix(path);
  const inScope = isTestFile(p) || p.startsWith("tests/");
  if (!inScope) return [];
  const out = [];
  const only = /\b(?:describe|it|test)\.only\s*\(/;
  const todo = /\b(?:describe|it|test)\.todo\s*\(/;
  // `.skip` modifier with a string-literal name as the first argument.
  const skipModifier = /\b(?:describe|it|test)\.skip\s*\(\s*["'`]/;
  for (const [n, text] of lines(content)) {
    if (only.test(text)) {
      out.push({
        line: n,
        message:
          "Focused test (.only) found. Remove it before merging — it silently disables every other test in the file.",
      });
    }
    if (skipModifier.test(text)) {
      out.push({
        line: n,
        message:
          "Skipped test (.skip modifier) found. Do not skip tests for code you add; delete the test or fix it (conditional `test.skip(cond, ...)` is allowed).",
      });
    }
    if (todo.test(text)) {
      out.push({
        line: n,
        message: "Placeholder test (.todo) found. Implement it or remove it — do not merge a stub.",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// File walking + orchestration.
// ---------------------------------------------------------------------------

const IGNORE_DIRS = new Set(["node_modules", ".git", ".output", ".vinxi", "dist", "coverage"]);

/** Recursively collect repo-relative POSIX paths of .ts/.tsx files under `dir`. */
function walkTsFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc; // directory absent in some checkouts; skip silently.
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.isDirectory() && entry.name !== ".github") {
      // skip hidden dirs (we never scan .github source here)
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walkTsFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(toPosix(relative(ROOT, full)));
    }
  }
  return acc;
}

// Each rule, with the top-level dirs it needs walked.
const RULES = [
  { name: "process.env scope", roots: ["app"], match: checkProcessEnv },
  {
    name: "unexplained ts-ignore",
    roots: ["app", "db", "scripts", "tests"],
    match: checkTsDirective,
  },
  { name: "db import in client code", roots: ["app"], match: checkClientDbImport },
  { name: "raw fetch to /api", roots: ["app"], match: checkRawApiFetch },
  { name: "test honesty", roots: ["app", "tests", "scripts"], match: checkTestHonesty },
];

function main() {
  // Collect the union of files to read once, then run every matcher over each.
  const rootDirs = new Set(RULES.flatMap((r) => r.roots));
  const files = new Set();
  for (const d of rootDirs) {
    for (const f of walkTsFiles(join(ROOT, d))) files.add(f);
  }

  let total = 0;
  // Deterministic ordering for stable output.
  const sorted = [...files].sort();
  for (const rel of sorted) {
    let content;
    try {
      const abs = join(ROOT, rel);
      if (!statSync(abs).isFile()) continue;
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    for (const rule of RULES) {
      for (const v of rule.match(content, rel)) {
        console.log(`::error file=${rel},line=${v.line}::[${rule.name}] ${v.message}`);
        total++;
      }
    }
  }

  if (total > 0) {
    console.error(
      `\n${total} Hard Rule violation(s) found. Each maps to an AGENTS.md "Hard Rules" item — fix them and re-run \`node .github/scripts/check-hard-rules.mjs\`.`
    );
    process.exit(1);
  }
  console.log("✓ No Hard Rule violations found.");
}

// Only run when invoked directly (not when imported by the unit tests).
if (process.argv[1] && toPosix(process.argv[1]).endsWith(".github/scripts/check-hard-rules.mjs")) {
  main();
}
