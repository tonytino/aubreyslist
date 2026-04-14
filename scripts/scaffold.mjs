#!/usr/bin/env node

/**
 * construct scaffold script
 *
 * Run once when cloning construct to initialize a new project instance.
 * This script modifies the repo in place and removes itself when done.
 *
 * Usage: pnpm scaffold
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline/promises";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, "utf-8");
}

function removeFile(filePath) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function slugify(name) {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

async function prompt(question, fallback) {
  const answer = await rl.question(question);
  return answer.trim() || fallback;
}

console.log("\n🔧 construct scaffold\n");
console.log("This will initialize a new project from this construct instance.");
console.log("Run this once. It cannot be undone.\n");

const confirm = await prompt("Continue? (yes/no): ", "no");
if (confirm !== "yes") {
  console.log("Aborted.");
  rl.close();
  process.exit(0);
}

console.log("");

const projectName = await prompt("Project name: ", "my-project");
const projectSlug = slugify(projectName);
const projectDescription = await prompt("Short description: ", "");

rl.close();

console.log("\nScaffolding...\n");

// 1. Read construct version from package.json before we modify it
const pkg = readJSON(path.join(ROOT, "package.json"));
const constructVersion = pkg.version;

// 2. Update package.json
pkg.name = projectSlug;
pkg.description = projectDescription;
pkg.version = "0.1.0";
delete pkg.scripts.scaffold;
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
writeFile(path.join(ROOT, ".construct"), JSON.stringify(constructMeta, null, 2) + "\n");
console.log("✓ .construct metadata written");

// 6. Remove construct-specific files
removeFile(path.join(ROOT, "TEMPLATE.md"));
console.log("✓ TEMPLATE.md removed");

// 7. Remove example Hono route and clean up server index
removeFile(path.join(ROOT, "app/server/routes/example.ts"));
const serverIndex = `import { Hono } from "hono";

// Mount your route groups here
// import { yourRoutes } from "./routes/your-resource";

const app = new Hono().basePath("/api");

// app.route("/your-resource", yourRoutes);

export type AppType = typeof app;

export default app;
`;
writeFile(path.join(ROOT, "app/server/index.ts"), serverIndex);
console.log("✓ Example routes cleaned up");

// 8. Remove this script
removeFile(path.join(ROOT, "scripts/scaffold.mjs"));
try { fs.rmdirSync(path.join(ROOT, "scripts")); } catch {}
console.log("✓ Scaffold script removed");

console.log(`
✅ Done! Your project "${projectName}" is ready.

Next steps:
  1. cp .env.example .env  (and fill in DATABASE_URL)
  2. pnpm install
  3. pnpm dev
`);
