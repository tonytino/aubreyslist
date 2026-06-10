#!/usr/bin/env node

/**
 * construct scaffold script
 *
 * Run once when cloning construct to initialize a new project instance.
 * This script modifies the repo in place and removes itself when done.
 *
 * Usage: pnpm scaffold
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { LABELS } from "./labels.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Interactive terminals get a readline interface; piped/non-interactive stdin
// (e.g. `printf '...' | node scaffold.mjs` in CI) is read in full once and
// consumed line-by-line. Line-by-line readline prompts silently drop buffered
// lines when stdin reaches EOF, so the two paths are kept separate.
const isInteractive = Boolean(process.stdin.isTTY);
const rl = isInteractive
  ? readline.createInterface({ input: process.stdin, output: process.stdout })
  : null;

/** @type {string[] | null} Lines from piped stdin, read lazily on first prompt. */
let pipedLines = null;
let pipedIndex = 0;

/**
 * Read the entire stdin stream to a string. Used only for non-interactive
 * (piped) input.
 * @returns {Promise<string>}
 */
async function readAllStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, "utf-8");
}

function removeFile(filePath) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * Prompt for one answer. Uses interactive readline when stdin is a TTY,
 * otherwise consumes the next line of piped stdin. Works reliably for
 * sequential prompts in both modes.
 * @param {string} question
 * @param {string} fallback Returned when the answer is empty.
 * @returns {Promise<string>}
 */
async function prompt(question, fallback) {
  if (rl) {
    const answer = await rl.question(question);
    return answer.trim() || fallback;
  }
  if (pipedLines === null) {
    pipedLines = (await readAllStdin()).split(/\r?\n/);
  }
  const raw = (pipedLines[pipedIndex++] ?? "").trim();
  // Echo the prompt + chosen answer so non-interactive runs are still readable.
  process.stdout.write(`${question}${raw}\n`);
  return raw || fallback;
}

/** Close the interactive readline interface, if one is open. */
function closePrompts() {
  rl?.close();
}

console.log("\n🔧 construct scaffold\n");
console.log("This will initialize a new project from this construct instance.");
console.log("Run this once. It cannot be undone.\n");

const confirm = await prompt("Continue? (yes/no): ", "no");
if (confirm !== "yes") {
  console.log("Aborted.");
  closePrompts();
  process.exit(0);
}

console.log("");

const projectName = await prompt("Project name: ", "my-project");
const projectSlug = slugify(projectName);
const projectDescription = await prompt("Short description: ", "");

console.log("\nScaffolding...\n");

// 1. Read construct version from package.json before we modify it
const pkg = readJSON(path.join(ROOT, "package.json"));
const constructVersion = pkg.version;

// 2. Update package.json
pkg.name = projectSlug;
pkg.description = projectDescription;
pkg.version = "0.1.0";
pkg.scripts.scaffold = undefined;
writeJSON(path.join(ROOT, "package.json"), pkg);
console.log("✓ package.json updated");

// 3. Update README.md
const readme = `# ${projectName}

${projectDescription}

## Stack

- **TanStack Start** — full-stack React framework
- **TanStack Router** — type-safe file-based routing
- **TanStack Query** — server state management
- **Tailwind CSS v4** — utility-first styling
- **Biome** — linting + formatting
- **Vitest** — unit and component testing
- **Playwright** — end-to-end testing
- **Hono** — API layer with RPC
- **Drizzle + Neon** — type-safe Postgres

## Getting Started

\`\`\`bash
pnpm install
cp .env.example .env
pnpm test:e2e:install
pnpm dev
\`\`\`

## For Agents

Read [\`AGENTS.md\`](./AGENTS.md) before making any changes.
`;
writeFile(path.join(ROOT, "README.md"), readme);
console.log("✓ README.md updated");

// 4. Initialize a fresh CHANGELOG.md for the project
const changelog = `# Changelog

All notable changes to ${projectName} will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]
`;
writeFile(path.join(ROOT, "CHANGELOG.md"), changelog);
console.log("✓ CHANGELOG.md initialized");

// 5. Write .construct metadata
const constructMeta = {
  constructVersion,
  projectName,
  projectSlug,
  scaffoldedAt: new Date().toISOString(),
};
writeFile(path.join(ROOT, ".construct"), `${JSON.stringify(constructMeta, null, 2)}\n`);
console.log("✓ .construct metadata written");

// 6. Remove construct-specific files
removeFile(path.join(ROOT, "TEMPLATE.md"));
console.log("✓ TEMPLATE.md removed");

// 7. Remove example Hono route (and its test) and clean up server index.
// Keep the handler block below in sync with app/server/index.ts.
removeFile(path.join(ROOT, "app/server/routes/example.ts"));
removeFile(path.join(ROOT, "app/server/index.test.ts"));
const serverIndex = `import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

// Mount your route groups here
// import { yourRoutes } from "./routes/your-resource";

const app = new Hono().basePath("/api");

// app.route("/your-resource", yourRoutes);

// Consistent JSON for unmatched routes instead of Hono's default text 404.
app.notFound((c) => c.json({ error: "Not Found" }, 404));

// Centralized error handling. Honor intentional HTTPExceptions; otherwise log
// and return a generic 500 without leaking internals (e.g. stack traces).
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export type AppType = typeof app;

export default app;
`;
writeFile(path.join(ROOT, "app/server/index.ts"), serverIndex);
console.log("✓ Example routes cleaned up");

// 8. Substitute project name into AGENTS.md
const agentsPath = path.join(ROOT, "AGENTS.md");
let agents = fs.readFileSync(agentsPath, "utf-8");
agents = agents.replace(/^# AGENTS\.md$/m, `# ${projectName}`);
agents = agents.replace(/the construct template/g, `the ${projectName} template`);
agents = agents.replace(/Propagating construct updates/g, `Propagating ${projectName} updates`);
writeFile(agentsPath, agents);
console.log("✓ AGENTS.md updated");

// 9. Set up GitHub issue labels (optional, requires gh auth login)
console.log("\n📋 GitHub Label Setup\n");
console.log("This will create the agentic task management labels in your GitHub repo.");
console.log("Requires: gh CLI installed and authenticated (gh auth login)\n");
console.log("Labels to create:");
for (const label of LABELS) {
  console.log(`  • ${label.name}`);
}

const setupLabels = await prompt("\nSet up GitHub labels now? (yes/no): ", "no");
closePrompts();

if (setupLabels === "yes") {
  console.log("\nCreating labels...\n");
  let labelErrors = 0;
  for (const label of LABELS) {
    try {
      execSync(
        `gh label create "${label.name}" --color "${label.color}" --description "${label.description}" --force`,
        { stdio: "pipe" }
      );
      console.log(`  ✓ ${label.name}`);
    } catch {
      console.log(`  ✗ ${label.name} (skipped — run manually if needed)`);
      labelErrors++;
    }
  }
  if (labelErrors > 0) {
    console.log(
      `\n  ${labelErrors} label(s) failed. Run: gh label create "<name>" --color "<hex>" --description "<desc>"`
    );
  } else {
    console.log("\n✓ Labels created");
  }
} else {
  console.log("\nSkipped. To set up labels later, run:");
  console.log("  node scripts/labels.mjs  (or re-run and choose yes)\n");
}

// 10. Remove scaffold scripts and the template-infrastructure tests that
// cover them (these test construct itself, not the scaffolded app; labels.test
// also imports scripts/labels.mjs, which is removed above).
removeFile(path.join(ROOT, "scripts/labels.mjs"));
removeFile(path.join(ROOT, "scripts/scaffold.mjs"));
try {
  fs.rmdirSync(path.join(ROOT, "scripts"));
} catch {}
removeFile(path.join(ROOT, "tests/unit/labels.test.ts"));
removeFile(path.join(ROOT, "tests/unit/templates.test.ts"));
try {
  fs.rmdirSync(path.join(ROOT, "tests/unit"));
} catch {}
console.log("✓ Scaffold scripts and template tests removed");

console.log(`
✅ Done! Your project "${projectName}" is ready.

Next steps:
  1. cp .env.example .env.local  (and fill in DATABASE_URL — see docs/agents/environment.md)
  2. pnpm install
  3. pnpm dev
`);
