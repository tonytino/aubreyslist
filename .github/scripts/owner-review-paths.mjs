// Single source of truth for the owner-review guardrail (ADR-015).
//
// This module defines which changes require the repo owner's explicit review.
// It is consumed by two places that must agree:
//   1. .github/scripts/check-owner-review.mjs — the CI detector (Layer 2).
//   2. tests/unit/check-owner-review.test.ts — asserts this list and
//      `.github/CODEOWNERS` (Layer 1) never drift apart (bidirectional).
//
// The design is two-layer (see docs/agents/governance.md):
//   Layer 1 (the teeth): .github/CODEOWNERS assigns exactly OWNED_PATHS to the
//     owner; GitHub branch protection ("Require review from Code Owners") makes
//     an owned-path PR unmergeable until the owner approves. Nothing here can
//     be bypassed by a collaborator, bot, or agent.
//   Layer 2 (the tripwire): the CI detector re-derives the same surface from
//     this module plus content signals paths can't see (destructive SQL, the
//     safety disclaimer, telemetry posture) and fails the PR unless it is
//     labeled `safe:human`. This stops an agent self-labeling a gated change
//     `safe:agent` (auto-mergeable).
//
// The backstop is asymmetric. Layer 1 (CODEOWNERS) backstops every miss in the
// path categories: a path-owned file cannot merge without the owner regardless
// of label, so the path checks can be simple. The CONTENT_CHECKS are different
// — they catch gated changes that land in unowned files (a disclaimer moved to
// a new component, a new telemetry init), which by definition have no Layer-1
// backstop. They are therefore best-effort heuristics: a content-category
// change in an unowned file that evades these patterns can still merge as
// `safe:agent`. Keep the patterns broad and treat this as a known residual
// limitation (documented in docs/agents/governance.md).
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
 * Keep this identical to the path tokens in `.github/CODEOWNERS`. The
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

  // ── Data / PII schema + migrations + DB connection (real user + health data) ──
  "/db/schema.ts",
  "/db/migrations/",
  "/db/client.ts",
  "/drizzle.config.ts",

  // ── Supply chain / legal ──
  // pnpm-workspace.yaml holds the supply-chain posture itself: the
  // `minimumReleaseAge` quarantine, its `minimumReleaseAgeExclude` fast-track
  // list, `blockExoticSubdeps`, the `allowBuilds` postinstall allowlist, and
  // the security-floor `overrides`. `/*.config.ts` matches .ts only, so it is
  // listed explicitly — a PR that only weakens it (deleting the quarantine,
  // adding a fast-track entry, lowering a floor) must trip the gate rather
  // than ship `safe:agent`. osv-scanner.toml is gated for the same reason: an
  // entry there is a decision to accept a known vulnerability.
  "/package.json",
  "/pnpm-lock.yaml",
  "/pnpm-workspace.yaml",
  "/osv-scanner.toml",
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
 * not in OWNED_PATHS. Each is a category with a `test(text)` predicate over a
 * single changed line and the diff `side` it applies to:
 *   - "add"  → only added (`+`) lines are inspected;
 *   - "both" → added and removed (`+`/`-`) lines are inspected (removing the
 *     disclaimer is as gate-worthy as changing it).
 *
 * `fileScope`, when set, restricts a check to changed lines whose file matches
 * (keeps the destructive-SQL scan to migration files only).
 */
export const CONTENT_CHECKS = [
  {
    kind: "destructive-migration",
    side: "add",
    fileScope: /(^|\/)db\/migrations\//,
    // Data-loss / integrity-loss operations. `SET DATA TYPE` / `ALTER COLUMN
    // ... TYPE` narrows a column (can truncate/round existing values); dropping
    // a constraint/NOT NULL/DEFAULT loses an invariant; RENAME + DELETE FROM
    // are destructive too. Any migration edit is already path-gated
    // (/db/migrations/ is an OWNED_PATH), so this list only sharpens the error
    // message — it does not need to be exhaustive to keep data-loss migrations
    // from shipping `safe:agent`. Destructive SQL executed from non-migration
    // app code (e.g. a raw `sql`TRUNCATE …`` in an unowned server module) is
    // out of scope here (see the residual-limitations note in
    // docs/agents/governance.md).
    patterns: [
      /\bdrop\s+table\b/i,
      /\bdrop\s+column\b/i,
      /\bdrop\s+constraint\b/i,
      /\bdrop\s+(not\s+null|default)\b/i,
      /\btruncate\b/i,
      /\bdelete\s+from\b/i,
      /\brename\s+(column|table|to)\b/i,
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
    // touching this framing (in any file — the disclaimer may move) is gated so
    // wording changes get the owner's sign-off. Broadened past the exact phrase
    // so a reworded variant in a new component still trips.
    patterns: [
      /medical\s+(advice|guidance|opinion)/i,
      /health\s+advice/i,
      /(not|isn'?t)\s+a\s+substitute\s+for/i,
      /professional\s+(medical|health)/i,
      /consult\s+(a|your)\s+(doctor|physician|healthcare)/i,
    ],
    message:
      "This change touches the medical-advice / safety-disclaimer copy. Changing the legal/safety framing requires the owner's explicit review (safe:human) — see docs/agents/governance.md.",
  },
  {
    kind: "telemetry-privacy",
    side: "add",
    // Data-collection posture: capturing PII in error/telemetry payloads,
    // changing sampling volume (also a cost lever), or wiring a new tracker.
    // Most telemetry lives in the already-owned instrument.server.mjs; these
    // catch a new init or tracker wiring elsewhere. Heuristic and deliberately
    // broad — it only forces `safe:human`, and a false positive is cheaper
    // than a silent new tracker capturing PII in an unowned file.
    patterns: [
      /senddefaultpii\s*:\s*true/i,
      /\b(traces|profiles)samplerate\s*:/i,
      /\breplays(session|onerror)samplerate\s*:/i,
      /\.setuser\s*\(/i, // Sentry.setUser({ email, id }) — member call, NOT the bare React useState setter
      /\b(posthog|segment|analytics|amplitude|mixpanel|rudderanalytics)\s*\.\s*identify\s*\(/i,
      /\bgtag\s*\(/i, // Google Analytics
      /from\s+["'](@sentry\/|posthog|mixpanel|@amplitude|@segment|@vercel\/analytics)/i,
    ],
    message:
      "This change alters data-collection / telemetry posture (PII capture, sampling volume, or a new tracker). It requires the owner's explicit review (safe:human) — see docs/agents/governance.md.",
  },
];

/** The label that marks a PR as owner-reviewed-and-merged-by-a-human. */
export const OWNER_LABEL = "safe:human";

/** The repo owner's GitHub handle (the sole code owner in .github/CODEOWNERS). */
export const OWNER_HANDLE = "@tonytino";
