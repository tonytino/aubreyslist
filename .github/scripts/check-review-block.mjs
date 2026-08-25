#!/usr/bin/env node

// Called by the `adversarial-review` job in .github/workflows/pr-conventions.yml.
//
// Validates that a PR body carries a well-formed specialist-review record, the
// committed evidence that the review panel in docs/agents/orchestration.md
// actually ran. A forcing function + auditable record, not proof: a body could
// be fabricated (see the "Honest limitation" note in orchestration.md).
//
// ── Routing ──────────────────────────────────────────────────────────────────
// Which lenses a PR owes is derived from its changed-file list, not from the
// author's judgement. `routeLenses()` is the single implementation; the panel
// runner (.claude/workflows/adversarial-review.mjs) routes conditional lenses
// by the same globs.
//
// PROSE_ONLY is an ALLOWLIST: a path routes the reduced panel only when it
// matches one of its entries, so any unrecognised path — a new top-level
// directory included — routes the full panel. Agent-governing prose
// (AGENTS.md, CLAUDE.md, docs/agents/**, .claude/**) and ADRs
// (docs/decisions/**) are outside the allowlist on purpose: they bind every
// future session. An empty changed-file list routes full.
//
// ── Validity contract ────────────────────────────────────────────────────────
// The body is valid iff both:
//   1. It contains a Markdown heading whose text is "Adversarial review"
//      (case-insensitive, any heading level `#`..`######`, surrounding
//      whitespace ignored); and
//   2. Within that heading's section (the lines up to the next heading of
//      same-or-shallower level, or end of body, with HTML comments stripped)
//      every ROUTED lens carries a verdict token, plus an `overall:` token:
//        a. with no escalation marker in the body, every routed lens and
//           `overall` must be `SHIP`;
//        b. with the marker — "Unresolved review items (escalated after review
//           cap)" or the legacy "…after 2-round cap" text, matched
//           case-insensitively body-wide because orchestration.md documents it
//           as its own `##` heading outside this section — every routed lens
//           and `overall` must carry `SHIP` or `CHANGES_REQUESTED`. The marker
//           permits unresolved findings, never an absent lens.
//      A routed lens with no token fails either way, as does a routed lens
//      recorded `n/a`. A lens that did not route may be `n/a` or absent.
//      Each token tolerates the forms orchestration.md documents and the
//      markdown people paste:
//        - the JSON verdict   `"correctness": "SHIP"`
//        - a bare token       `correctness: SHIP`
//        - bold emphasis      `**correctness**: SHIP` / `**correctness: SHIP**`
//      The `(?<![\w-])` / `(?![\w-])` guards keep `SHIPPED`, `SHIP-NOT` and
//      `metadata: SHIP` (for the `data` lens) out. Tokens are section-scoped so
//      stray tokens in unrelated prose do not satisfy the gate; a section
//      holding only the template placeholder comment or a bare `-` carries no
//      tokens and fails.
//
// Inputs come from process.env (PR_BODY, CHANGED_FILES) — never from argv
// inline — so a hostile body or filename can't inject into the calling shell
// (mirrors how the pr-title job passes the title via env to commitlint).

export const ALWAYS_ON = ["correctness", "security", "conventions", "architecture"];
export const CONDITIONAL = ["design", "accessibility", "copy", "performance", "data"];

/** The panel a diff of pure prose owes. */
export const REDUCED = ["conventions", "copy"];

/** Changed-file globs that route each conditional lens. */
const UI_GLOBS = [/^app\/components\//, /^app\/routes\/.*\.tsx$/, /\.css$/, /^components\.json$/];
const CONDITIONAL_GLOBS = {
  design: UI_GLOBS,
  accessibility: UI_GLOBS,
  copy: UI_GLOBS,
  performance: [/^app\/server\//, /^db\//, /^package\.json$/, /^vite\.config\.ts$/],
  data: [/^db\//, /^drizzle\.config\.ts$/],
};

/**
 * Is `file` prose for routing purposes? The allowlist: a root-level `*.md`
 * other than AGENTS.md / CLAUDE.md, `docs/**` outside `docs/agents/**` and
 * `docs/decisions/**`, `changelog.d/**`, and LICENSE. Everything else is code
 * as far as the panel is concerned. An ADR records a binding decision — ADR-015
 * is the owner-review guardrail itself — so it earns the full panel.
 *
 * @param {string} file - repo-relative POSIX path.
 * @returns {boolean}
 */
export function isProsePath(file) {
  if (typeof file !== "string" || file === "") return false;
  if (file === "LICENSE") return true;
  if (file.startsWith("changelog.d/")) return true;
  if (file.startsWith("docs/")) {
    return !file.startsWith("docs/agents/") && !file.startsWith("docs/decisions/");
  }
  if (/^[^/]+\.md$/.test(file)) return file !== "AGENTS.md" && file !== "CLAUDE.md";
  return false;
}

/**
 * The lenses a PR touching `changedFiles` owes a verdict for. Pure: the caller
 * supplies the file list.
 *
 * @param {string[]} changedFiles - repo-relative POSIX paths.
 * @returns {string[]} lens names, in roster order.
 */
export function routeLenses(changedFiles) {
  const files = (Array.isArray(changedFiles) ? changedFiles : [])
    .filter((f) => typeof f === "string")
    .map((f) => f.trim())
    .filter(Boolean);

  // An empty list is unreadable, not harmless: route the always-on panel.
  if (files.length > 0 && files.every(isProsePath)) return [...REDUCED];

  const routed = CONDITIONAL.filter((lens) => {
    if (lens === "copy" && files.some(isProsePath)) return true;
    return files.some((f) => CONDITIONAL_GLOBS[lens].some((re) => re.test(f)));
  });
  return ALWAYS_ON.concat(routed);
}

/** Strip `<!-- ... -->` HTML comments so a template placeholder comment isn't mistaken for content. */
function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Verdict token for one lens. `verdicts` is a regex alternation of the accepted
 * verdict words. The word-boundary guards are stricter than `\b`: they also
 * reject a hyphen, so `SHIP-NOT` fails and `metadata: SHIP` cannot satisfy the
 * `data` lens.
 */
function tokenRe(lens, verdicts) {
  return new RegExp(
    `(?<![\\w-])["'*_]*${lens}["'*_]*\\s*:\\s*["'*_]*(?:${verdicts})(?![\\w-])`,
    "i"
  );
}

const SHIP = "ship";
const ANY_VERDICT = "ship|changes[-_ ]?requested";
const NOT_APPLICABLE = "n\\s*/\\s*a";

/**
 * Validate that `body` records a verdict for every lens in `routedLenses`.
 * Pure and unit-testable — see tests/unit/review-block.test.ts.
 *
 * @param {string} body - the raw PR description.
 * @param {string[]} routedLenses - from {@link routeLenses}.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateReviewBlock(body, routedLenses) {
  // A caller with no routing still owes the always-on panel.
  const routed = Array.isArray(routedLenses) && routedLenses.length > 0 ? routedLenses : ALWAYS_ON;

  if (typeof body !== "string" || body.trim() === "") {
    return { ok: false, reason: "PR body is empty." };
  }

  const lines = body.split(/\r?\n/);

  // Find the "Adversarial review" heading (any level, case-insensitive).
  const headingRe = /^(#{1,6})\s+adversarial review\s*$/i;
  let headingIdx = -1;
  let headingLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m) {
      headingIdx = i;
      headingLevel = m[1].length;
      break;
    }
  }
  if (headingIdx === -1) {
    return { ok: false, reason: "Missing an `## Adversarial review` heading in the PR body." };
  }

  // Body-wide: orchestration.md documents the marker as its own `## ` heading,
  // which the section boundary below cuts off. Both the current text ("review
  // cap") and the legacy text ("2-round cap") count.
  const escalationRe = /unresolved review items \(escalated after (?:2-round|review) cap\)/i;
  const escalated = escalationRe.test(stripHtmlComments(body));

  // Collect the section body: until the next heading of same-or-shallower level.
  const sectionLines = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+\S/);
    if (m && m[1].length <= headingLevel) break;
    sectionLines.push(lines[i]);
  }

  const section = stripHtmlComments(sectionLines.join("\n"));

  // Reject an empty / bare-placeholder section (e.g. only a `-` from the template).
  const meaningful = section
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && l !== "-");
  if (meaningful.length === 0) {
    return {
      ok: false,
      reason:
        "The `## Adversarial review` section is empty or still contains only the template placeholder.",
    };
  }

  // Per routed lens: which requirement it fails, so the error can name it.
  const accepted = escalated ? ANY_VERDICT : SHIP;
  const missing = [];
  const notApplicable = [];
  const contested = [];
  for (const lens of routed) {
    if (tokenRe(lens, accepted).test(section)) continue;
    if (tokenRe(lens, NOT_APPLICABLE).test(section)) notApplicable.push(lens);
    else if (tokenRe(lens, ANY_VERDICT).test(section)) contested.push(lens);
    else missing.push(lens);
  }

  const faults = [];
  if (missing.length > 0) faults.push(`no verdict token for ${missing.join(", ")}`);
  if (notApplicable.length > 0)
    faults.push(`\`n/a\` where a verdict is owed: ${notApplicable.join(", ")}`);
  if (contested.length > 0) {
    faults.push(
      `${contested.join(", ")} not SHIP, with no escalation block naming the unresolved findings`
    );
  }
  if (faults.length > 0) {
    return {
      ok: false,
      reason:
        `The \`## Adversarial review\` section does not clear every lens this diff routes ` +
        `(${routed.join(", ")}): ${faults.join("; ")}.`,
    };
  }

  const overallRe = tokenRe("overall", escalated ? ANY_VERDICT : SHIP);
  if (!overallRe.test(section)) {
    return {
      ok: false,
      reason:
        "The `## Adversarial review` section records every routed lens but no `overall:` verdict.",
    };
  }

  return { ok: true };
}

/** What the author must do, given what this diff routed. */
function remedy(routed) {
  return (
    `This diff routes ${routed.length} lens(es): ${routed.join(", ")}. Put an ` +
    "`## Adversarial review` section in the PR body with a `<lens>: SHIP` line for each of them " +
    "plus `overall: SHIP`, and apply the `review:adversarial-passed` label. A lens that ends " +
    "`CHANGES_REQUESTED` also needs the block 'Unresolved review items (escalated after review " +
    "cap)' listing what still stands. A lens outside that list may be recorded `n/a` or left " +
    "out. Routing follows the changed-file globs in docs/agents/orchestration.md."
  );
}

/** Split a newline-delimited env value into a clean array (paths may contain commas). */
function splitLines(value) {
  return (value ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function main() {
  const routed = routeLenses(splitLines(process.env.CHANGED_FILES));
  const result = validateReviewBlock(process.env.PR_BODY ?? "", routed);
  if (result.ok) {
    console.log(`✓ PR body records a verdict for every routed lens: ${routed.join(", ")}.`);
    process.exit(0);
  }
  console.error(`::error::Adversarial review gate failed: ${result.reason} ${remedy(routed)}`);
  process.exit(1);
}

// Only run main() when executed directly, not when imported by the unit test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
