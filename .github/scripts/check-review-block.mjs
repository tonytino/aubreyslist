#!/usr/bin/env node

// Called by the `adversarial-review` job in .github/workflows/pr-conventions.yml.
//
// Validates that a PR body carries a well-formed specialist-review record, the
// committed evidence that the review panel in docs/agents/orchestration.md
// actually ran. A forcing function + auditable record, not proof: a body could
// be fabricated (see the "Honest limitation" note in orchestration.md).
//
// ── Validity contract ────────────────────────────────────────────────────────
// The body is valid iff both:
//   1. It contains a Markdown heading whose text is "Adversarial review"
//      (case-insensitive, any heading level `#`..`######`, surrounding
//      whitespace ignored); and
//   2. Either:
//        a. within that heading's section (the lines up to the next heading of
//           same-or-shallower level, or end of body, with HTML comments
//           stripped) there is a SHIP token for EACH always-on lens —
//           correctness, security, conventions, architecture — AND an overall
//           SHIP token. Each token tolerates the exact forms orchestration.md
//           documents and the markdown people paste:
//             - the JSON verdict   `"correctness": "SHIP"`
//             - a bare token       `correctness: SHIP`
//             - bold emphasis      `**correctness**: SHIP` / `**correctness: SHIP**`
//           i.e. /["'*_]*<lens>["'*_]*\s*:\s*["'*_]*ship(?![\w-])/i per lens.
//           The trailing `(?![\w-])` stops `SHIPPED` / `SHIP-NOT`. Tokens are
//           section-scoped so stray tokens in unrelated prose do not satisfy
//           the gate. Conditional-lens lines (design / accessibility / copy /
//           performance / data) are recorded as SHIP or `n/a` but not
//           validated — routing decides whether they ran. A bare legacy
//           `overall: SHIP` with no per-lens lines fails; or
//        b. an escalation marker appears anywhere in the body:
//           "Unresolved review items (escalated after review cap)" or the
//           legacy "Unresolved review items (escalated after 2-round cap)"
//           (case-insensitive) — the legacy text stays valid so in-flight PRs
//           keep passing. orchestration.md documents the marker as its own
//           `##` heading, which the section boundary in (a) would cut off — so
//           it is matched body-wide. Its text is specific enough that a
//           body-wide match won't false-positive.
//   3. As part of (2a): after stripping HTML comments (the template's
//      `<!-- ... -->` instruction) a section holding only the template
//      placeholder / comment / a bare `-` has no SHIP tokens and (absent the
//      escalation marker) does not pass.
//
// It is invalid (and main() exits 1) when the heading is missing, or there is
// neither a complete in-section per-lens record nor an escalation marker.
//
// The PR body is read from process.env.PR_BODY — never from argv inline — so a
// hostile body can't inject into the calling shell (mirrors how the pr-title
// job passes the title via env to commitlint).

const ALWAYS_ON = ["correctness", "security", "conventions", "architecture"];

const REMEDY =
  "Add an `## Adversarial review` section to the PR body containing the panel record — a " +
  "`<lens>: SHIP` line for each of correctness, security, conventions, architecture " +
  "(conditional lenses as SHIP or `n/a`) plus `overall: SHIP` — or the escalation block " +
  "'Unresolved review items (escalated after review cap)', and apply the " +
  "`review:adversarial-passed` label. For a trivial or human-only change, apply the " +
  "`skip-review` label instead. See docs/agents/orchestration.md.";

/** Strip `<!-- ... -->` HTML comments so a template placeholder comment isn't mistaken for content. */
function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * SHIP token for one lens. Tolerates the JSON verdict (`"correctness": "SHIP"`),
 * a bare token (`correctness: SHIP`), and bold emphasis (`**correctness**:
 * SHIP`). The trailing `(?![\w-])` stops `SHIPPED` and `SHIP-NOT` from passing
 * (a bare `\b` would still match before the hyphen in `SHIP-NOT`).
 */
function shipTokenRe(lens) {
  return new RegExp(`["'*_]*${lens}["'*_]*\\s*:\\s*["'*_]*ship(?![\\w-])`, "i");
}

/**
 * Validate that `body` contains a well-formed specialist-review record.
 * Pure and unit-testable — see tests/unit/review-block.test.ts.
 *
 * @param {string} body - the raw PR description.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateReviewBlock(body) {
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

  // The escalation marker is matched body-wide: orchestration.md documents it
  // as its own `## ` heading, which the section boundary below would cut off.
  // Both the current text ("review cap") and the legacy text ("2-round cap")
  // pass, so in-flight PRs keep validating.
  const escalationRe = /unresolved review items \(escalated after (?:2-round|review) cap\)/i;
  if (escalationRe.test(stripHtmlComments(body))) {
    return { ok: true };
  }

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

  // Panel record, section-scoped: every always-on lens must SHIP, plus overall.
  const missing = ALWAYS_ON.filter((lens) => !shipTokenRe(lens).test(section));
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `The \`## Adversarial review\` section is missing a SHIP token for: ${missing.join(", ")} ` +
        "(and has no escalation marker).",
    };
  }
  if (!shipTokenRe("overall").test(section)) {
    return {
      ok: false,
      reason:
        "The `## Adversarial review` section has per-lens SHIP tokens but no `overall: SHIP` " +
        "(and no escalation marker).",
    };
  }

  return { ok: true };
}

function main() {
  const result = validateReviewBlock(process.env.PR_BODY ?? "");
  if (result.ok) {
    console.log("✓ PR body carries a well-formed specialist-review record.");
    process.exit(0);
  }
  console.error(`::error::Adversarial review gate failed: ${result.reason} ${REMEDY}`);
  process.exit(1);
}

// Only run main() when executed directly, not when imported by the unit test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
