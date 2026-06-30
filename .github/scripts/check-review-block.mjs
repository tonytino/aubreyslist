#!/usr/bin/env node

// Called by the `adversarial-review` job in .github/workflows/pr-conventions.yml.
//
// Validates that a PR body carries a well-formed adversarial-review record, the
// committed evidence that the 2-round review loop in docs/agents/orchestration.md
// actually ran. This is a forcing function + auditable record, NOT proof: a body
// could be fabricated (see the "Honest limitation" note in orchestration.md).
//
// ── Validity contract ────────────────────────────────────────────────────────
// The body is VALID iff BOTH:
//   1. It contains a Markdown heading whose text is "Adversarial review"
//      (case-insensitive, any heading level `#`..`######`, surrounding
//      whitespace ignored); AND
//   2. EITHER:
//        a. a passing-verdict token is found WITHIN that heading's section
//           (the lines up to the next heading of same-or-shallower level, or end
//           of body, with HTML comments stripped). The token tolerates the exact
//           forms orchestration.md documents and the markdown people paste:
//             - the JSON verdict   `"overall": "SHIP"`
//             - a bare token       `overall: SHIP`
//             - bold emphasis      `**overall**: SHIP` / `**overall: SHIP**`
//           i.e. /["'*_]*overall["'*_]*\s*:\s*["'*_]*ship(?![\w-])/i. The
//           trailing `(?![\w-])` stops `SHIPPED` / `SHIP-NOT`. SHIP is SECTION-scoped so a stray
//           "overall: SHIP" in unrelated prose does NOT satisfy the gate; OR
//        b. the documented escalation marker appears ANYWHERE in the body:
//           "Unresolved review items (escalated after 2-round cap)"
//           (case-insensitive). orchestration.md documents this as its own `##`
//           heading, which the section boundary in (a) would cut off — so this
//           marker is matched body-wide. Its text is specific enough that a
//           body-wide match won't false-positive.
//   3. As part of (2a): after stripping HTML comments (the template's
//      `<!-- ... -->` instruction) a section holding ONLY the template
//      placeholder / comment / a bare `-` has no SHIP token and (absent the
//      escalation marker) does not pass.
//
// It is INVALID (and main() exits 1) when the heading is missing, or there is
// neither an in-section SHIP token nor the escalation marker anywhere.
//
// The PR body is read from process.env.PR_BODY — NEVER from argv inline — so a
// hostile body can't inject into the calling shell (mirrors how the pr-title job
// passes the title via env to commitlint).

const REMEDY =
  "Add an `## Adversarial review` section to the PR body containing the reviewer's " +
  "`overall: SHIP` verdict (or the escalation block 'Unresolved review items " +
  "(escalated after 2-round cap)'), and apply the `review:adversarial-passed` label. " +
  "For a trivial or human-only change, apply the `skip-review` label instead. " +
  "See docs/agents/orchestration.md.";

/** Strip `<!-- ... -->` HTML comments so a template placeholder comment isn't mistaken for content. */
function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Validate that `body` contains a well-formed adversarial-review record.
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

  // The escalation marker is matched BODY-WIDE: orchestration.md documents it as
  // its own `## ` heading, which the section boundary below would cut off. Its
  // text is specific enough that a body-wide match won't false-positive.
  const escalationRe = /unresolved review items \(escalated after 2-round cap\)/i;
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

  // Passing verdict, SECTION-scoped. Tolerates the JSON verdict (`"overall":
  // "SHIP"`), a bare token (`overall: SHIP`), and bold emphasis (`**overall**:
  // SHIP`). The trailing `(?![\w-])` stops `SHIPPED` and `SHIP-NOT` from passing
  // (a bare `\b` would still match before the hyphen in `SHIP-NOT`).
  const shipRe = /["'*_]*overall["'*_]*\s*:\s*["'*_]*ship(?![\w-])/i;
  if (shipRe.test(section)) {
    return { ok: true };
  }

  return {
    ok: false,
    reason:
      "The `## Adversarial review` section has no passing verdict (`overall: SHIP`) " +
      "and no escalation marker ('Unresolved review items (escalated after 2-round cap)').",
  };
}

function main() {
  const result = validateReviewBlock(process.env.PR_BODY ?? "");
  if (result.ok) {
    console.log("✓ PR body carries a well-formed adversarial-review record.");
    process.exit(0);
  }
  console.error(`::error::Adversarial review gate failed: ${result.reason} ${REMEDY}`);
  process.exit(1);
}

// Only run main() when executed directly, not when imported by the unit test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
