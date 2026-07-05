import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Pure, filesystem-touching helpers backing the AUB-186 guard scan in
 * `server-fn-post-guards.test.ts`. Split into a non-`.test.` module so Biome's
 * `noExportsInTest` rule (test files shouldn't export things for others to
 * import) doesn't apply — this module is exported-from-and-imported-by
 * exactly one test file, but it isn't itself a test file.
 */

export const GUARD_CALL_RE = /\brequire(?:CurrentUser|CurrentRole|Role|User)\s*\(/;

/** Matches the start of every `export const NAME = createServerFn(` call site. */
const CREATE_SERVER_FN_CALL_RE = /export const (\w+)\s*=\s*createServerFn\(/g;

/** Every raw `createServerFn(` call site, regardless of how it's assigned. */
const CREATE_SERVER_FN_CALL_SITE_RE = /\bcreateServerFn\s*\(/g;

/**
 * Naive comment stripper (line `//...` and block `/* ... *\/` comments) used
 * by `createServerFnCallCount` and `callsAuthGuard` below, so a doc comment
 * that happens to mention `createServerFn(...)` or `requireCurrentUser(...)`
 * in prose (e.g. explaining the convention) isn't miscounted as a real call
 * site — a comment-only guard mention must NOT satisfy the guard scan.
 * Doesn't handle `//`/`/*` appearing inside a string literal, which is an
 * acceptable heuristic gap here — this repo's `*.fn.ts` files don't do that,
 * and `serverFnExports` itself is unaffected either way (it only matches
 * actual `export const NAME = ...` assignments, which don't occur in
 * comments).
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

export function toPosix(path: string): string {
  return path.split(sep).join("/");
}

/**
 * Index of the `{`/`(` character matching the one at `openIndex`, scanning
 * forward with brace-depth tracking (so nested `{}`/`()` inside the options
 * object — e.g. a nested validator config — don't confuse it). Returns `-1`
 * if unbalanced.
 */
function findMatchingBracket(source: string, openIndex: number): number {
  const openChar = source[openIndex];
  const closeChar = openChar === "{" ? "}" : ")";
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export interface ServerFnExport {
  name: string;
  /** HTTP method declared in the options object, or `null` if none could be parsed. */
  method: string | null;
}

/**
 * Every `export const NAME = createServerFn(...)` call in `source`, with its
 * HTTP method extracted from the options object.
 *
 * Deliberately does NOT anchor the whole options object to a single-property
 * `{ method: "POST" }` shape: it locates `createServerFn(`, then does a
 * balanced-brace scan to grab the full options object text (whatever else it
 * contains, however it's wrapped across lines, trailing comma or not), and
 * regexes `method:\s*["']...["']` out of THAT slice. This is what lets it
 * recognize e.g. `createServerFn({ method: "POST", strict: false })` or a
 * Biome-formatted multi-line block with a trailing comma — shapes a
 * `createServerFn\(\s*\{\s*method:...\s*\}\s*\)`-anchored regex would silently
 * miss (and, worse, miss SILENTLY: no describe block, no failure, no
 * exception needed — see AUB-186 review history).
 *
 * If the options argument isn't an object literal, or no `method:` property
 * is found inside it, `method` is `null` rather than the export being
 * dropped — callers (and the call-count canary below) can then decide how to
 * treat an unparsed shape, instead of it vanishing from the scan.
 */
export function serverFnExports(source: string): ServerFnExport[] {
  const results: ServerFnExport[] = [];
  for (const m of source.matchAll(CREATE_SERVER_FN_CALL_RE)) {
    const name = m[1];
    if (!name) continue;
    const openParenIdx = m.index + m[0].length - 1;
    let i = openParenIdx + 1;
    while (i < source.length && /\s/.test(source[i] ?? "")) i++;
    if (source[i] !== "{") {
      results.push({ name, method: null });
      continue;
    }
    const closeBraceIdx = findMatchingBracket(source, i);
    if (closeBraceIdx === -1) {
      results.push({ name, method: null });
      continue;
    }
    const optionsText = source.slice(i, closeBraceIdx + 1);
    const methodMatch = optionsText.match(/\bmethod\s*:\s*["'](\w+)["']/);
    results.push({ name, method: methodMatch?.[1] ?? null });
  }
  return results;
}

/**
 * Count of every raw `createServerFn(` call site in `source`, independent of
 * how (or whether) `serverFnExports` above manages to parse it. Used as a
 * cross-check canary (see the test file) so a `createServerFn` call shape
 * `serverFnExports` can't parse — e.g. it isn't `export const NAME = ...` at
 * all — fails the suite loudly instead of just being silently absent from the
 * scan.
 */
export function createServerFnCallCount(source: string): number {
  return [...stripComments(source).matchAll(CREATE_SERVER_FN_CALL_SITE_RE)].length;
}

/** Recursively collect absolute paths of every `*.fn.ts` file under `dir`. */
export function walkFnFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFnFiles(full, acc);
    } else if (entry.isFile() && entry.name.endsWith(".fn.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

/** Local (relative or `~/`-aliased) import specifiers referenced anywhere in `source`. */
export function localImportSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  const patterns = [
    /from\s+["'](\.[^"']+|~\/[^"']+)["']/g,
    /import\(\s*["'](\.[^"']+|~\/[^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      const specifier = m[1];
      if (specifier) specs.add(specifier);
    }
  }
  return [...specs];
}

/**
 * Resolve a local import specifier referenced from a file in `fromDir` to an
 * existing source file on disk, or `null` if it doesn't resolve (external
 * package, or a `~/` specifier outside `app/` — never expected here). `~/` is
 * this repo's `tsconfig.json` path alias for `./app`.
 *
 * `repoRoot` is passed in (rather than computed here) so the resolver works
 * against BOTH the real repo (for the `~/` alias) and an isolated temp
 * directory in tests (which has no `app/` of its own but only ever uses
 * relative `./...` specifiers).
 */
export function resolveLocalSpecifier(
  specifier: string,
  fromDir: string,
  repoRoot: string
): string | null {
  const base = specifier.startsWith("~/")
    ? join(repoRoot, "app", specifier.slice(2))
    : resolve(fromDir, specifier);
  const candidates = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/**
 * True if `source` (the contents of the `*.fn.ts` file at `fileAbs`) itself
 * calls an auth guard, or delegates to a locally-imported module that does
 * (one hop — see the module doc in `server-fn-post-guards.test.ts`).
 */
export function callsAuthGuard(fileAbs: string, source: string, repoRoot: string): boolean {
  // Strip comments FIRST: a doc comment merely mentioning `requireCurrentUser(...)`
  // must not satisfy the scan — only a real (non-commented) call counts.
  const code = stripComments(source);
  if (GUARD_CALL_RE.test(code)) return true;
  const dir = dirname(fileAbs);
  for (const specifier of localImportSpecifiers(code)) {
    const resolved = resolveLocalSpecifier(specifier, dir, repoRoot);
    if (!resolved) continue;
    if (GUARD_CALL_RE.test(stripComments(readFileSync(resolved, "utf8")))) return true;
  }
  return false;
}

/**
 * Names of every POST `createServerFn(...)` export in `source`, regardless of
 * what other options accompany `method: "POST"` or how the call is
 * whitespace-/comma-formatted. See `serverFnExports` for how that's done.
 */
export function postServerFnExports(source: string): string[] {
  return serverFnExports(source)
    .filter((e) => e.method === "POST")
    .map((e) => e.name);
}
