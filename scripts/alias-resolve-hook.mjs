// @ts-nocheck — plain ESM loader hook, run by Node outside the type-checked app graph.
//
// ESM resolve hook that teaches a raw `node` process the project's `~/` path
// aliases (the same ones in tsconfig.json: `~/db/*` → `db/*`, `~/*` → `app/*`).
//
// Why this exists: `scripts/seed-admin.ts` imports app modules (`~/env`,
// `~/db/client`) that themselves import via `~/`. Vitest understands these
// aliases through `vite-tsconfig-paths`, but a bare `node` invocation does not,
// and the repo intentionally has no `tsx`/`ts-node` dependency. This tiny,
// dependency-free hook bridges that gap so `pnpm db:seed-admin` can run the
// script with `node --experimental-strip-types` and nothing else. It mirrors
// the build-time tooling exception already granted to `drizzle.config.ts`.
//
// It only rewrites `~/`-prefixed specifiers; everything else falls through to
// Node's default resolver unchanged.

import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();

// Node's ESM resolver requires an explicit file extension; TypeScript source
// imports omit it. Resolve a bare alias path to the real on-disk file.
function resolveWithExtension(absPath) {
  if (existsSync(absPath)) return absPath;
  for (const ext of [".ts", ".tsx", ".mjs", ".js"]) {
    if (existsSync(absPath + ext)) return absPath + ext;
  }
  for (const idx of ["index.ts", "index.tsx", "index.js"]) {
    const candidate = path.join(absPath, idx);
    if (existsSync(candidate)) return candidate;
  }
  return absPath;
}

export async function resolve(specifier, context, nextResolve) {
  // `~/` aliases → repo-root `db/` or `app/` (mirrors tsconfig.json paths).
  let aliasRelative;
  if (specifier.startsWith("~/db/")) {
    aliasRelative = path.join("db", specifier.slice("~/db/".length));
  } else if (specifier.startsWith("~/")) {
    aliasRelative = path.join("app", specifier.slice("~/".length));
  }

  if (aliasRelative !== undefined) {
    const absolute = resolveWithExtension(path.join(root, aliasRelative));
    return nextResolve(pathToFileURL(absolute).href, context);
  }

  // Relative TS imports (e.g. `db/client.ts` → `./schema`) omit the extension,
  // which Node's resolver rejects. Append it against the importing module's dir.
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
    const parentDir = path.dirname(new URL(context.parentURL).pathname);
    const absolute = resolveWithExtension(path.resolve(parentDir, specifier));
    if (existsSync(absolute)) {
      return nextResolve(pathToFileURL(absolute).href, context);
    }
  }

  return nextResolve(specifier, context);
}
