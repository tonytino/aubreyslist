// @ts-nocheck — plain ESM CI glue, run by node in `.github/workflows/migrate-preview.yml`.
//
// Resolve the Neon connection URI for a PR's Vercel **preview** database branch
// (AUB-139), so a GitHub Action can apply Drizzle migrations to it. Without this,
// a schema PR's preview 500s: the Neon↔Vercel integration forks the preview branch
// from PRODUCTION, which isn't migrated until the PR merges, so the deployed
// preview code queries a column/table the preview DB doesn't have yet.
//
// The testable core is {@link resolvePreviewConnectionUri} (all I/O injected). The
// thin {@link main} reads env, masks the URI in the log, writes it to
// `$GITHUB_OUTPUT` (`url` + `found`), and records a step summary. It NEVER throws on
// "branch not found" — it sets `found=false` (a loud, visible skip via a
// `::warning::` + step summary) so a reviewer can tell the preview was NOT migrated,
// rather than the skip hiding behind a green check. It DOES hard-fail on genuine
// misconfiguration (e.g. an ambiguous/absent NEON_PROJECT_ID) so the fix is seen.

import { appendFileSync } from "node:fs";

const NEON_API = "https://console.neon.tech/api/v2";

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET a Neon API path with bearer auth, JSON-decoded. Retries transient failures
 * (network error or 5xx) with a short backoff, so a Neon hiccup doesn't fail an
 * otherwise-good schema PR; a 4xx (client/config error, e.g. a 400 from an
 * org-scoped key) throws immediately since retrying can't help.
 */
async function neonGet(
  apiKey,
  path,
  fetchImpl,
  { retries = 2, retryDelayMs = 1000, sleep = sleepMs } = {}
) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let res;
    try {
      res = await fetchImpl(`${NEON_API}${path}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(retryDelayMs);
        continue;
      }
      throw error;
    }
    if (res.ok) return res.json();
    // 5xx is transient (retry); 4xx is a client/config error (fail fast).
    if (res.status >= 500 && attempt < retries) {
      await sleep(retryDelayMs);
      continue;
    }
    throw new Error(`Neon API GET ${path} → ${res.status} ${res.statusText}`);
  }
  throw lastError;
}

/** Guidance appended to every project-resolution failure — the one-line fix. */
const SET_PROJECT_ID =
  "Set the NEON_PROJECT_ID repo secret (Neon console → your project → Settings, " +
  "or the project ID in its dashboard URL).";

/**
 * Resolve the project id: use the provided one, else the account's sole project.
 *
 * Auto-detection calls `GET /projects`, which fails for an ORGANIZATION-scoped API
 * key (it returns 400 without an `org_id`) — so any failure here rethrows with the
 * actionable "set NEON_PROJECT_ID" fix rather than a raw HTTP error. Passing
 * NEON_PROJECT_ID skips this call entirely and works with any key type.
 */
async function resolveProjectId(apiKey, projectId, fetchImpl) {
  if (projectId) return projectId;

  let projects;
  try {
    ({ projects } = await neonGet(apiKey, "/projects", fetchImpl));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not auto-detect the Neon project (${detail}). ${SET_PROJECT_ID}`);
  }

  if (!projects || projects.length === 0) {
    throw new Error(`No Neon projects found for this API key. ${SET_PROJECT_ID}`);
  }
  if (projects.length > 1) {
    throw new Error(`This Neon API key has ${projects.length} projects. ${SET_PROJECT_ID}`);
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
 * Retries the branch lookup for up to ~3 minutes by default, because Vercel may
 * still be creating the Neon preview branch right after a first deploy — the
 * timing this action races. Returns `{ found: false }` when it never appears — a
 * graceful, VISIBLE skip (see {@link main}), not an error; a later push (or a
 * re-run once the preview deploy has finished) applies it. On success returns the
 * direct (non-pooled) URI, which is what drizzle-kit's migrate wants for DDL.
 */
export async function resolvePreviewConnectionUri({
  apiKey,
  projectId,
  branchName,
  fetchImpl = fetch,
  sleep = sleepMs,
  attempts = 12,
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

/** Append a line to the GitHub Actions step summary (visible on the run page). */
function writeSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${markdown}\n`);
}

/**
 * CLI shell: resolve, mask the URI, write step outputs, and record a summary.
 * All side-effects are injected so {@link main} is testable without touching the
 * network or the runner's files.
 */
export async function main({
  env = process.env,
  log = console,
  resolve = resolvePreviewConnectionUri,
  writeOut = writeOutput,
  summarize = writeSummary,
} = {}) {
  const result = await resolve({
    apiKey: env.NEON_API_KEY,
    projectId: env.NEON_PROJECT_ID,
    branchName: env.PREVIEW_BRANCH_NAME,
  });

  if (!result.found) {
    // A VISIBLE skip (minor review finding): a `::warning::` annotation + a step
    // summary, so a green check never hides "the preview was NOT migrated".
    const msg = `Preview database NOT migrated: Neon branch "${env.PREVIEW_BRANCH_NAME}" was not found (Vercel may still be creating it). Re-run this workflow once the preview deploy has finished, or it will apply on the next push.`;
    log.log(`::warning::${msg}`);
    summarize(`### ⚠️ Preview database not migrated\n\n${msg}`);
    writeOut("found", "false");
    return 0;
  }

  // Mask the URI job-wide BEFORE writing it to a step output, so the later migrate
  // step's `DATABASE_URL` is masked in logs too. Never print the URI itself.
  log.log(`::add-mask::${result.uri}`);
  writeOut("url", result.uri);
  writeOut("found", "true");
  summarize(
    `### ✅ Migrating preview database\n\nApplying migrations to \`${env.PREVIEW_BRANCH_NAME}\`.`
  );
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
