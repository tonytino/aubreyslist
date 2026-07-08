// Single source of truth for the owner-review guardrail (ADR-015).
//
// This module defines WHICH changes require the repo owner's explicit review.
// It is consumed by two places that MUST agree:
//   1. .github/scripts/check-owner-review.mjs — the CI detector (Layer 2).
//   2. tests/unit/check-owner-review.test.ts — asserts this list and
//      `.github/CODEOWNERS` (Layer 1) never drift apart (bidirectional).
//
// The design is two-layer (see docs/agents/governance.md):
//   Layer 1 (the teeth): .github/CODEOWNERS assigns exactly OWNED_PATHS to the
//     owner; GitHub branch protection ("Require review from Code Owners") makes an
//     owned-path PR unmergeable until the owner approves. Nothing here can be
//     bypassed by a collaborator, bot, or agent.
//   Layer 2 (the tripwire): the CI detector re-derives the same surface from this
//     module PLUS a few content signals paths can't see (destructive SQL, the
//     safety disclaimer, telemetry posture) and FAILS the PR unless it is labeled
//     `safe:human`. This stops an agent self-labeling a gated change `safe:agent`
//     (auto-mergeable). Layer 1 backstops every miss, so this stays deliberately
//     simple — false negatives here still cannot merge without the owner.
//
// The seven owner-gated categories (ADR-015): cost, legal, security, trust &
// safety model, destructive/irreversible data changes, data-collection/privacy
// posture, and safety/medical-disclaimer copy.

/**
 * OWNED_PATHS — the exact path tokens that appear in `.github/CODEOWNERS`.
 *
 * Each entry uses GitHub CODEOWNERS glob semantics (gitignore-style):
 *   - a leading `/` anchors to the repo root;
 *   - a trailing `/` matches everything under that directory;
 *   - `*` matches any run of non-`/` characters; `?` matches one non-`/` char;
 *   - other characters (including `.` and `$`) are literal.
 *
 * KEEP THIS IDENTICAL to the path tokens in `.github/CODEOWNERS`. The
 * bidirectional drift test fails the build if the two sets ever diverge.
 *
 * @type {string[]}
 */
export const OWNED_PATHS = [
  // ── Cost / billed infrastructure (Google Places, Sentry volume, rate ceiling) ──
  "/app/server/places.ts",
  "/app/server/rate-limit/",
  "/instrument.server.mjs",

  // ── Security: auth, session, middleware chokepoints, privilege/RBAC ──
  "/app/server/auth/",
  "/app/server/security/",
  "/app/server/admin/",
  "/scripts/seed-admin.ts",
  "/app/server/routes/auth.ts",
  "/app/server/index.ts",
  "/app/start.ts",
  "/app/routes/api.$.ts",

  // ── Trust & safety model (ADR-007/008/010): a corrupted safety signal can
  //    cause real-world harm on a celiac-safety product ──
  "/app/trust/",
  "/app/server/attestations/",
  "/app/server/incidents/",
  "/app/server/moderation/",
  "/app/server/flags/",

  // ── Secrets / environment ──
  "/app/env.ts",
  "/.env.example",
  "/.gitignore",

  // ── Data / PII schema + migrations (real user + health-incident data) ──
  "/db/schema.ts",
  "/db/migrations/",
  "/drizzle.config.ts",

  // ── Supply chain / legal ──
  "/package.json",
  "/pnpm-lock.yaml",
  "/LICENSE",

  // ── Safety / medical-disclaimer copy (current home; the content check below
  //    catches the disclaimer even if it moves to another file) ──
  "/app/components/SiteFooter.tsx",

  // ── Guardrail integrity + CI-config surface. Owning these makes the guardrail
  //    self-protecting: weakening any gate needs the owner's review. `/.github/`
  //    covers CODEOWNERS itself, every workflow, and every guard script. The
  //    config files are the "loosen the tests instead of the guard" hole
  //    (e.g. vitest.config.ts holds the coverage floor). `/*.config.ts` covers
  //    root vite/vitest/drizzle/playwright configs. ──
  "/.github/",
  "/scripts/labels.mjs",
  "/AGENTS.md",
  "/docs/decisions/",
  "/*.config.ts",
  "/tsconfig*.json",
  "/commitlint.config.mjs",
  "/biome.json",
  "/knip.jsonc",
  "/stryker.conf.json",
];

/**
 * Content signals that require owner review even when the edit lands in a file
 * NOT in OWNED_PATHS. Each is a category with a `test(text)` predicate over a
 * single changed line and the diff `side` it applies to:
 *   - "add"  → only added (`+`) lines are inspected;
 *   - "both" → added and removed (`+`/`-`) lines are inspected (removing the
 *     disclaimer is as gate-worthy as changing it).
 *
 * `fileScope`, when set, restricts a check to changed lines whose file matches
 * (used to keep the destructive-SQL scan to migration files only).
 */
export const CONTENT_CHECKS = [
  {
    kind: "destructive-migration",
    side: "add",
    fileScope: /(^|\/)db\/migrations\//,
    // Drizzle emits these for data-loss operations. `SET DATA TYPE` / `ALTER
    // COLUMN ... TYPE` narrows a column (can truncate/round existing values).
    patterns: [
      /\bdrop\s+table\b/i,
      /\bdrop\s+column\b/i,
      /\btruncate\b/i,
      /\bset\s+data\s+type\b/i,
      /\balter\s+column\b[^\n;]*\btype\b/i,
    ],
    message:
      "This migration contains an irreversible / data-loss operation against real user + health-incident data. It requires the owner's explicit review (safe:human) — see docs/agents/governance.md.",
  },
  {
    kind: "safety-disclaimer",
    side: "both",
    // The "not medical advice" framing is a legal + safety statement. Any line
    // touching the phrase is gated so wording changes get the owner's sign-off.
    patterns: [/medical\s+advice/i],
    message:
      "This change touches the medical-advice / safety-disclaimer copy. Changing the legal/safety framing requires the owner's explicit review (safe:human) — see docs/agents/governance.md.",
  },
  {
    kind: "telemetry-privacy",
    side: "add",
    // Data-collection posture: capturing PII in error/telemetry payloads or
    // changing sampling volume (also a cost lever). Most telemetry lives in the
    // already-owned instrument.server.mjs; this catches a new init elsewhere.
    patterns: [
      /senddefaultpii\s*:\s*true/i,
      /\btracessamplerate\s*:/i,
      /\bprofilessamplerate\s*:/i,
      /\breplays(session|onerror)samplerate\s*:/i,
    ],
    message:
      "This change alters data-collection / telemetry posture (PII capture or sampling volume). It requires the owner's explicit review (safe:human) — see docs/agents/governance.md.",
  },
];

/** The label that marks a PR as owner-reviewed-and-merged-by-a-human. */
export const OWNER_LABEL = "safe:human";

/** The repo owner's GitHub handle (the sole code owner in .github/CODEOWNERS). */
export const OWNER_HANDLE = "@tonytino";
