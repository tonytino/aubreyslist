#!/usr/bin/env node

/**
 * Changelog fragments tool.
 *
 * Pending changelog entries live as individual files under `changelog.d/`
 * instead of a hand-edited `## [Unreleased]` block, so concurrent PRs never
 * collide on CHANGELOG.md. This script previews them, validates them in CI,
 * and assembles them into a versioned section at release time.
 *
 * Fragment files are named `<slug>.<category>.md`, where <category> is one of
 * the Keep a Changelog sections (added/changed/deprecated/removed/fixed/
 * security). Each non-empty line is a Markdown bullet beginning with a
 * propagation tag, e.g.:
 *
 *   - `[propagate]` Did the thing instances should also do.
 *
 * Usage:
 *   node scripts/changelog.mjs preview            # render the pending section
 *   node scripts/changelog.mjs check              # validate fragments (CI)
 *   node scripts/changelog.mjs release <version>  # cut a release, consume fragments
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FRAGMENT_DIR = path.join(ROOT, "changelog.d");
const CHANGELOG = path.join(ROOT, "CHANGELOG.md");

// Keep a Changelog categories, in the canonical order they render in.
export const CATEGORIES = ["added", "changed", "deprecated", "removed", "fixed", "security"];

// Every bullet must carry exactly one propagation tag (see docs/agents/releases.md).
const TAG_RE = /`\[(?:propagate|template-only|manual)\]`/;

/**
 * Parse a fragment filename into its slug and category.
 * @param {string} filename e.g. "46-node-pin.added.md"
 * @returns {{ slug: string, category: string }}
 * @throws if the name doesn't match `<slug>.<category>.md` with a known category
 */
export function parseFragmentName(filename) {
  const match = /^(.+)\.([a-z]+)\.md$/.exec(filename);
  if (!match) {
    throw new Error(`"${filename}" must be named <slug>.<category>.md (e.g. 42-thing.added.md)`);
  }
  const [, slug, category] = match;
  if (!CATEGORIES.includes(category)) {
    throw new Error(
      `"${filename}" has unknown category "${category}" — use one of: ${CATEGORIES.join(", ")}`
    );
  }
  return { slug, category };
}

/**
 * Extract the bullet lines from a fragment's raw contents (drops blanks).
 * @param {string} content
 * @returns {string[]}
 */
export function bulletsOf(content) {
  return content
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
}

/**
 * Validate one fragment. Returns a list of human-readable problems (empty = ok).
 * @param {string} filename
 * @param {string} content
 * @returns {string[]}
 */
export function validateFragment(filename, content) {
  const errors = [];
  try {
    parseFragmentName(filename);
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)];
  }
  const bullets = bulletsOf(content);
  if (bullets.length === 0) {
    errors.push(`${filename}: no entries (file is empty)`);
  }
  for (const line of bullets) {
    if (!line.startsWith("- ")) {
      errors.push(`${filename}: line is not a Markdown bullet ("- ..."): ${line}`);
    } else if (!TAG_RE.test(line)) {
      errors.push(
        `${filename}: bullet has no \`[propagate]\`/\`[template-only]\`/\`[manual]\` tag: ${line}`
      );
    }
  }
  return errors;
}

/**
 * Read and parse every fragment in `changelog.d/` (ignores README.md).
 * @returns {{ filename: string, slug: string, category: string, bullets: string[] }[]}
 */
export function readFragments() {
  if (!fs.existsSync(FRAGMENT_DIR)) return [];
  return fs
    .readdirSync(FRAGMENT_DIR)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort()
    .map((filename) => {
      const { slug, category } = parseFragmentName(filename);
      const content = fs.readFileSync(path.join(FRAGMENT_DIR, filename), "utf-8");
      return { filename, slug, category, bullets: bulletsOf(content) };
    });
}

/**
 * Group fragment bullets by category. Bullets keep filename (sorted) order.
 * @param {{ category: string, bullets: string[] }[]} fragments
 * @returns {Record<string, string[]>}
 */
export function groupByCategory(fragments) {
  /** @type {Record<string, string[]>} */
  const grouped = {};
  for (const { category, bullets } of fragments) {
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(...bullets);
  }
  return grouped;
}

/**
 * Render a CHANGELOG section body (the `### Added` … blocks) for a heading.
 * @param {string} heading e.g. "## [Unreleased]" or "## [1.2.0] - 2026-01-01"
 * @param {Record<string, string[]>} grouped
 * @returns {string}
 */
export function renderSection(heading, grouped) {
  const blocks = [heading];
  for (const category of CATEGORIES) {
    const bullets = grouped[category];
    if (!bullets || bullets.length === 0) continue;
    const title = category[0].toUpperCase() + category.slice(1);
    blocks.push(`### ${title}\n\n${bullets.join("\n")}`);
  }
  return `${blocks.join("\n\n")}\n`;
}

/**
 * Insert a new release section directly below the `## [Unreleased]` block,
 * above the most recent versioned section.
 * @param {string} changelogText
 * @param {string} sectionMarkdown the rendered `## [X.Y.Z] - DATE` block
 * @returns {string}
 */
export function insertReleaseSection(changelogText, sectionMarkdown) {
  const lines = changelogText.split("\n");
  // The first versioned heading (## [1.2.3]) — i.e. not [Unreleased].
  const idx = lines.findIndex((line) => /^## \[\d/.test(line));
  const block = `${sectionMarkdown}\n---\n`;
  if (idx === -1) {
    // No prior releases — append at the end.
    return `${changelogText.replace(/\n+$/, "")}\n\n${block}`;
  }
  lines.splice(idx, 0, ...block.split("\n"));
  return lines.join("\n");
}

function cmdPreview() {
  const fragments = readFragments();
  if (fragments.length === 0) {
    console.log("## [Unreleased]\n\n_No pending changelog fragments._");
    return;
  }
  process.stdout.write(renderSection("## [Unreleased]", groupByCategory(fragments)));
}

function cmdCheck() {
  if (!fs.existsSync(FRAGMENT_DIR)) {
    console.log("No changelog.d/ directory — nothing to validate.");
    return;
  }
  const files = fs
    .readdirSync(FRAGMENT_DIR)
    .filter((name) => name !== "README.md" && !name.startsWith("."));
  const errors = [];
  for (const filename of files) {
    if (!filename.endsWith(".md")) {
      errors.push(`${filename}: only .md fragments belong in changelog.d/`);
      continue;
    }
    const content = fs.readFileSync(path.join(FRAGMENT_DIR, filename), "utf-8");
    errors.push(...validateFragment(filename, content));
  }
  if (errors.length > 0) {
    console.error("Invalid changelog fragments:\n");
    for (const e of errors) console.error(`  • ${e}`);
    console.error("\nSee docs/agents/releases.md for the fragment format.");
    process.exitCode = 1;
    return;
  }
  console.log(`✓ ${files.length} changelog fragment(s) valid`);
}

/**
 * @param {string | undefined} version
 * @param {string} date YYYY-MM-DD
 */
function cmdRelease(version, date) {
  if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
    console.error("Usage: node scripts/changelog.mjs release <version>  (e.g. 0.3.0)");
    process.exitCode = 1;
    return;
  }
  const fragments = readFragments();
  if (fragments.length === 0) {
    console.error("No changelog fragments to release. Add some under changelog.d/ first.");
    process.exitCode = 1;
    return;
  }
  const section = renderSection(`## [${version}] - ${date}`, groupByCategory(fragments));
  const updated = insertReleaseSection(fs.readFileSync(CHANGELOG, "utf-8"), section);
  fs.writeFileSync(CHANGELOG, updated);
  for (const { filename } of fragments) {
    fs.unlinkSync(path.join(FRAGMENT_DIR, filename));
  }
  console.log(
    `✓ Released [${version}] from ${fragments.length} fragment(s); consumed files removed.`
  );
}

// Dispatch only when run directly, so the helpers above stay importable in tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case "preview":
      cmdPreview();
      break;
    case "check":
      cmdCheck();
      break;
    case "release": {
      const date = new Date().toISOString().slice(0, 10);
      cmdRelease(arg, date);
      break;
    }
    default:
      console.error("Usage: node scripts/changelog.mjs <preview|check|release> [version]");
      process.exitCode = 1;
  }
}
