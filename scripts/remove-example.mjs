#!/usr/bin/env node

/**
 * Remove the example Hono route and its dependency.
 *
 * The template ships a request-validation example at
 * `app/server/routes/example.ts` (using `@hono/zod-validator`), mounted at
 * `/api/example`, plus a `GET /api/health` route that stays. If your project
 * doesn't need the validation example, run this once:
 *
 *   node scripts/remove-example.mjs
 *
 * It deletes the route and its test, unmounts it from `app/server/index.ts`,
 * and drops `@hono/zod-validator` from package.json. Run `pnpm install` after.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const IMPORT_LINE = 'import { exampleRoutes } from "./routes/example";\n';
const MOUNT_BLOCK = `// Example route demonstrating request validation with @hono/zod-validator.
// Don't need it? Run \`node scripts/remove-example.mjs\` to delete the route and
// drop the dependency (see docs/agents/api.md).
app.route("/example", exampleRoutes);`;

/**
 * Delete the example route + test, unmount it from the server index, and drop
 * the `@hono/zod-validator` dependency. Safe to run more than once.
 * @returns {string[]} the paths that were removed
 */
export function removeExample() {
  const removed = [];
  for (const rel of ["app/server/routes/example.ts", "app/server/routes/example.test.ts"]) {
    const p = path.join(ROOT, rel);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      removed.push(rel);
    }
  }

  const indexPath = path.join(ROOT, "app/server/index.ts");
  if (fs.existsSync(indexPath)) {
    const index = fs
      .readFileSync(indexPath, "utf-8")
      .replace(IMPORT_LINE, "")
      .replace(MOUNT_BLOCK, "")
      .replace(/\n{3,}/g, "\n\n");
    fs.writeFileSync(indexPath, index);
  }

  const pkgPath = path.join(ROOT, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  pkg.dependencies = Object.fromEntries(
    Object.entries(pkg.dependencies).filter(([name]) => name !== "@hono/zod-validator")
  );
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  return removed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  removeExample();
  console.log(
    "✓ Removed the example route and dropped @hono/zod-validator.\n" +
      "  Run `pnpm install` to update the lockfile."
  );
}
