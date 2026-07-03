// @ts-nocheck — plain ESM CI glue, run by node in `.github/workflows/migrate-preview.yml`.
//
// Resolve the Neon connection URI for a PR's Vercel **preview** database branch
// (AUB-139), so a GitHub Action can apply Drizzle migrations to it. Without this,
// a schema PR's preview 500s: the Neon↔Vercel integration forks the preview branch
// from PRODUCTION, which isn't migrated until the PR merges, so the deployed
// preview code queries a column/table the preview DB doesn't have yet.
//
// The testable core is {@link resolvePreviewConnectionUri} (all I/O injected). The
// thin {@link main} reads env, masks the URI in the log, and writes it to
// `$GITHUB_OUTPUT` (`url` + `found`). It NEVER throws on "branch not found" — it
// sets `found=false` so the workflow skips the migrate step gracefully (the branch
// may still be being created by Vercel; a later push re-runs this).

import { appendFileSync } from "node:fs";

const NEON_API = "https://console.neon.tech/api/v2";

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET a Neon API path with bearer auth; throws on a non-2xx (a real API error). */
async function neonGet(apiKey, path, fetchImpl) {
  const res = await fetchImpl(`${NEON_API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Neon API GET ${path} → ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Resolve the project id: use the provided one, else the account's sole project. */
async function resolveProjectId(apiKey, projectId, fetchImpl) {
  if (projectId) return projectId;
  const { projects } = await neonGet(apiKey, "/projects", fetchImpl);
  if (!projects || projects.length === 0) {
    throw new Error("No Neon projects found for this API key — set NEON_PROJECT_ID.");
  }
  if (projects.length > 1) {
    throw new Error(
      `Neon API key has ${projects.length} projects — set NEON_PROJECT_ID to disambiguate.`
    );
  }
  return projects[0].id;
}

/** Find a branch by EXACT name (e.g. `preview/<git-branch>`), or null. */
async function findBranchByName(apiKey, projectId, branchName, fetchImpl) {
  const { branches } = await neonGet(apiKey, `/projects/${projectId}/branches`, fetchImpl);
  return (branches ?? []).find((b) => b.name === branchName) ?? null;
}

/**
 * Resolve the connection URI for the PR's preview branch.
 *
 * Retries the branch lookup (Vercel may still be creating it right after a first
 * deploy). Returns `{ found: false }` when it never appears — a graceful skip, not
 * an error. On success returns the direct (non-pooled) URI, which is what
 * drizzle-kit's migrate wants for DDL.
 */
export async function resolvePreviewConnectionUri({
  apiKey,
  projectId,
  branchName,
  fetchImpl = fetch,
  sleep = sleepMs,
  attempts = 6,
  delayMs = 15000,
  log = console,
}) {
  if (!apiKey) throw new Error("NEON_API_KEY is required.");
  if (!branchName) throw new Error("branchName (preview/<git-branch>) is required.");

  const pid = await resolveProjectId(apiKey, projectId, fetchImpl);

  let branch = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    branch = await findBranchByName(apiKey, pid, branchName, fetchImpl);
    if (branch) break;
    if (attempt < attempts) {
      log.warn(
        `Preview branch "${branchName}" not found yet (attempt ${attempt}/${attempts}); retrying…`
      );
      await sleep(delayMs);
    }
  }

  if (!branch) {
    return { found: false, projectId: pid };
  }

  // The preview branch forks production, so it carries prod's database + owner
  // role — resolve them rather than guessing a name.
  const { databases } = await neonGet(
    apiKey,
    `/projects/${pid}/branches/${branch.id}/databases`,
    fetchImpl
  );
  const database = (databases ?? [])[0];
  if (!database) {
    throw new Error(`Preview branch "${branchName}" has no databases.`);
  }

  const query = new URLSearchParams({
    branch_id: branch.id,
    database_name: database.name,
    role_name: database.owner_name,
    pooled: "false",
  });
  const { uri } = await neonGet(
    apiKey,
    `/projects/${pid}/connection_uri?${query.toString()}`,
    fetchImpl
  );
  if (!uri) {
    throw new Error(`Neon returned no connection URI for branch "${branchName}".`);
  }

  return { found: true, uri, projectId: pid, branchId: branch.id };
}

/** Append a `key=value` line to the GitHub Actions step output file. */
function writeOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${key}=${value}\n`);
}

/** CLI shell: read env, resolve, mask the URI, and write step outputs. */
export async function main(env = process.env, log = console) {
  const result = await resolvePreviewConnectionUri({
    apiKey: env.NEON_API_KEY,
    projectId: env.NEON_PROJECT_ID,
    branchName: env.PREVIEW_BRANCH_NAME,
  });

  if (!result.found) {
    log.log(
      `::warning::No Neon preview branch "${env.PREVIEW_BRANCH_NAME}" — skipping preview migrate.`
    );
    writeOutput("found", "false");
    return 0;
  }

  // Mask the URI everywhere in the log BEFORE it can be echoed, then hand it to
  // the migrate step via a (masked) output. Never print the URI itself.
  log.log(`::add-mask::${result.uri}`);
  writeOutput("url", result.uri);
  writeOutput("found", "true");
  log.log(`Resolved preview branch (${result.branchId}) connection URI.`);
  return 0;
}

// Run when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
