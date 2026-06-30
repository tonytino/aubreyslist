/**
 * Canonical label definitions for the agentic task management workflow.
 *
 * Imported by scaffold.mjs to create labels in GitHub on first setup.
 * Imported by tests to verify label definitions are correct and complete.
 *
 * If you change this taxonomy, update docs/agents/tasks.md in sync.
 *
 * @typedef {{ name: string; color: string; description: string }} Label
 */

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** @type {Label[]} */
export const LABELS = [
  // ── Status ──────────────────────────────────────────────────────────────────
  // Mutually exclusive. Drives the agent workflow state machine.
  {
    name: "status:ready",
    color: "0075ca",
    description: "Scoped and ready for an agent to claim",
  },
  {
    name: "status:in-progress",
    color: "e4e669",
    description: "Claimed by an agent — do not pick up",
  },
  {
    name: "status:blocked",
    color: "d93f0b",
    description: "Waiting on something external before work can continue",
  },
  {
    name: "status:needs-review",
    color: "0e8a16",
    description: "Agent finished — awaiting human review before closing",
  },

  // ── Type ────────────────────────────────────────────────────────────────────
  { name: "type:bug", color: "d73a4a", description: "Something is broken" },
  { name: "type:feature", color: "a2eeef", description: "New functionality" },
  {
    name: "type:chore",
    color: "cfd3d7",
    description: "Maintenance, cleanup, or tooling change",
  },
  { name: "type:docs", color: "0052cc", description: "Documentation change" },
  {
    name: "type:epic",
    color: "5319e7",
    description:
      "A tracked epic — a parent grouping of work-item sub-issues; not directly claimable",
  },

  // ── Size ────────────────────────────────────────────────────────────────────
  // Scope for a single agent working independently in one session.
  {
    name: "size:xs",
    color: "f9d0c4",
    description: "< 30 min, single file",
  },
  {
    name: "size:s",
    color: "f9d0c4",
    description: "< 2 hrs, isolated change",
  },
  {
    name: "size:m",
    color: "f9d0c4",
    description: "2–4 hrs, touches multiple files",
  },
  {
    name: "size:l",
    color: "e99695",
    description: "Requires a planning session first — not directly claimable",
  },

  // ── Safety ──────────────────────────────────────────────────────────────────
  {
    name: "safe:agent",
    color: "bfd4f2",
    description: "Agent can execute without human pre-approval",
  },
  {
    name: "safe:human",
    color: "e4b429",
    description: "Human must approve before the agent begins work",
  },

  // ── Meta ──────────────────────────────────────────────────────────────────
  {
    name: "skip-changelog",
    color: "ededed",
    description: "PR intentionally ships without a changelog fragment",
  },
  {
    name: "review:adversarial-passed",
    color: "0e8a16",
    description: "Adversarial review loop completed (orchestration.md) — required to merge",
  },
  {
    name: "skip-review",
    color: "ededed",
    description: "Bypasses the adversarial-review gate (trivial/human-only change)",
  },
];

/**
 * Create (or update) every label in {@link LABELS} on the current GitHub repo
 * via the `gh` CLI. Requires `gh` installed and authenticated against the repo.
 * Shared by the scaffold script and the direct-run entrypoint below.
 *
 * @returns {{ created: number, failed: number, firstError: unknown }}
 */
export function createLabels() {
  let created = 0;
  let failed = 0;
  let firstError = null;
  for (const label of LABELS) {
    try {
      // Pass arguments as an argv array (no shell) so label fields containing
      // quotes, backticks, $, ; etc. can never break or inject into a command.
      execFileSync(
        "gh",
        [
          "label",
          "create",
          label.name,
          "--color",
          label.color,
          "--description",
          label.description,
          "--force",
        ],
        { stdio: "pipe" }
      );
      console.log(`  ✓ ${label.name}`);
      created++;
    } catch (err) {
      if (!firstError) firstError = err;
      console.log(`  ✗ ${label.name} (skipped)`);
      failed++;
    }
  }
  return { created, failed, firstError };
}

// Runnable directly: `node scripts/labels.mjs` (re)creates the labels later,
// e.g. when label setup was skipped or failed during scaffold. The guard keeps
// this from firing when the module is imported (by scaffold.mjs or the tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log("Creating GitHub labels (requires the gh CLI, authenticated)...\n");
  const { created, failed, firstError } = createLabels();
  if (failed > 0) {
    // Surface the underlying gh error once so the cause (not installed, not
    // authenticated, wrong repo) is visible instead of silently swallowed.
    const detail =
      firstError?.stderr?.toString().trim() ||
      (firstError instanceof Error ? firstError.message : String(firstError));
    console.log(`\n${failed} label(s) failed. First error from gh:`);
    console.log(`  ${detail}`);
    console.log("Fix it (e.g. `gh auth login`) and re-run `node scripts/labels.mjs`.");
    process.exitCode = 1;
  } else {
    console.log(`\n✓ Created ${created} labels`);
  }
}
