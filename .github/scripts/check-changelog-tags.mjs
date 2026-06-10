#!/usr/bin/env node

// Called by .github/workflows/release-check.yml.
// Fails with a non-zero exit code if any bullet in the CHANGELOG section for
// $VERSION is missing a `[propagate]`, `[template-only]`, or `[manual]` tag.

import { readFileSync } from "node:fs";

const version = process.env.VERSION;
if (!version) {
  console.error("VERSION env var not set");
  process.exit(2);
}

const changelog = readFileSync("CHANGELOG.md", "utf8");
const lines = changelog.split(/\r?\n/);

const headerRegex = /^## \[(.+?)\]/;
let inTarget = false;
const bullets = [];

for (const line of lines) {
  const match = line.match(headerRegex);
  if (match) {
    inTarget = match[1] === version;
    continue;
  }
  // Top-level bullets only — nested sub-bullets are exempt from tagging by design.
  if (inTarget && /^- /.test(line)) {
    bullets.push(line);
  }
}

if (bullets.length === 0) {
  console.error(`No bullets found under [${version}] section. Did you add content?`);
  process.exit(1);
}

const tagRegex = /^- `\[(propagate|template-only|manual)\]`/;
const untagged = bullets.filter((b) => !tagRegex.test(b));

if (untagged.length > 0) {
  console.error(`CHANGELOG entries for [${version}] missing propagation tags:`);
  for (const b of untagged) console.error(`  ${b}`);
  console.error(
    "\nEach bullet must start with `[propagate]`, `[template-only]`, or `[manual]`. See docs/agents/releases.md."
  );
  process.exit(1);
}

console.log(`All ${bullets.length} CHANGELOG entries for [${version}] have propagation tags.`);
