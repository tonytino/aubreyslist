#!/usr/bin/env node

// Called by the `pr-tldr` job in .github/workflows/pr-conventions.yml.
//
// Validates that a PR body carries a plain-language TL;DR — the 1–3 sentences a
// non-engineer can understand, which slack-merge-updates.yml posts to Slack when
// the PR merges (see docs/agents/merge-updates.md). Like the adversarial-review
// gate, this is a forcing function: it can't judge whether the prose is actually
// jargon-free, only that the author wrote *something* real in the section.
//
// ── Validity contract ────────────────────────────────────────────────────────
// The body is VALID iff BOTH:
//   1. It contains an ATX Markdown heading whose text is "TL;DR"
//      (case-insensitive, any heading level `#`..`######`, surrounding
//      whitespace and trailing `:`/`.`/`!` punctuation ignored). The spelling
//      variants "TLDR" and "TL DR" are tolerated so a hand-typed heading
//      doesn't fail on punctuation. ATX-only is deliberate: the template
//      already provides the `## TL;DR` heading to fill in, so the setext form
//      (`TL;DR` underlined with `---`/`===`) is not recognized; AND
//   2. The section content (the lines up to the next heading of same-or-
//      shallower level, or end of body), AFTER stripping HTML comments, has at
//      least one meaningful line — not empty and not the template's bare `-`
//      placeholder. Comment-stripping is what rejects a body where the only
//      "content" is the template's `<!-- ... -->` instruction block, and an
//      UNCLOSED `<!--` is treated as running to the end of the text so a typo'd
//      comment can't count as content.
//
// Heading detection is code-fence aware: a `## TL;DR` line inside a ```/~~~
// fenced block is NOT the heading (it's sample text), and a fenced `## Foo`
// inside the real TL;DR section does NOT terminate the section early.
//
// It is INVALID (and main() exits 1) when the heading is missing or the section
// is empty / placeholder-only.
//
// The PR body is read from process.env.PR_BODY — NEVER from argv inline — so a
// hostile body can't inject into the calling shell (mirrors how the pr-title job
// passes the title via env to commitlint, and how check-review-block.mjs reads
// its input).
//
// The heading/section helpers are exported and shared with
// .github/scripts/slack-merge-update.mjs so the CI gate and the Slack pipeline
// can never drift on what counts as "the TL;DR section".

const REMEDY =
  "Add a `## TL;DR` section at the top of the PR body with 1–3 plain sentences " +
  "a non-engineer can understand — what changed and why it matters. It gets " +
  "posted to Slack when the PR merges. See docs/agents/merge-updates.md.";

// Heading text matcher: "TL;DR" plus the tolerated variants "TLDR" and "TL DR"
// (any mix of spaces/semicolons between the two halves). Anchored per-line by
// the caller; case-insensitive.
const TLDR_TEXT_RE = /tl[\s;]*dr/i;

/**
 * Strip `<!-- ... -->` HTML comments so a template instruction isn't mistaken
 * for content. An UNCLOSED `<!--` extends to the end of the text — that's how
 * browsers/GitHub treat it, and it stops a typo'd comment (missing `-->`) from
 * counting as meaningful TL;DR content.
 */
export function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?(-->|$)/g, "");
}

/**
 * True when a line opens/closes a Markdown code fence (``` or ~~~, optionally
 * indented). Fence-info strings (```js) are fine — the toggle only cares about
 * the leading fence characters.
 */
function isFenceLine(line) {
  return /^\s*(```|~~~)/.test(line);
}

/**
 * Parse an ATX heading line into { level, text }, or null. Trailing `:`/`.`/`!`
 * punctuation is stripped from the text so `## TL;DR:` (which GitHub renders
 * fine) matches. Setext headings (`text` + `---` underline) are deliberately
 * not recognized — see the header comment.
 */
function parseHeading(line) {
  const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
  if (!m) return null;
  return { level: m[1].length, text: m[2].replace(/[\s:.!]+$/, "") };
}

/** True when a heading's text is exactly a TL;DR variant (nothing else). */
function isTldrHeadingText(text) {
  return TLDR_TEXT_RE.test(text) && text.replace(TLDR_TEXT_RE, "").trim() === "";
}

/**
 * Find the TL;DR section in a PR body and return its content.
 *
 * Shared semantics for the CI gate (validateTldrBlock) and the Slack pipeline
 * (slack-merge-update.mjs's extractTldr): the section is the lines after the
 * TL;DR heading, up to the next heading of same-or-shallower level (or end of
 * body), with HTML comments stripped. Heading matches inside fenced code
 * blocks are ignored in BOTH directions: a fenced `## TL;DR` is not the
 * heading, and a fenced `## Foo` does not end the section.
 *
 * @param {string} body - the raw PR description.
 * @returns {{ found: boolean, section: string }}
 */
export function extractTldrSection(body) {
  if (typeof body !== "string" || body.trim() === "") {
    return { found: false, section: "" };
  }

  // Single pass over the document so the code-fence state carries seamlessly
  // from the heading search into the section-boundary scan.
  let inFence = false;
  let found = false;
  let headingLevel = 0;
  const sectionLines = [];

  for (const line of body.split(/\r?\n/)) {
    if (isFenceLine(line)) {
      inFence = !inFence;
      if (found) sectionLines.push(line);
      continue;
    }

    if (!inFence) {
      const heading = parseHeading(line);
      if (heading) {
        if (!found && isTldrHeadingText(heading.text)) {
          found = true;
          headingLevel = heading.level;
          continue;
        }
        // Same-or-shallower heading ends the section; deeper ones belong to it.
        if (found && heading.level <= headingLevel) break;
      }
    }

    if (found) sectionLines.push(line);
  }

  if (!found) {
    return { found: false, section: "" };
  }
  return { found: true, section: stripHtmlComments(sectionLines.join("\n")) };
}

/**
 * Extract the meaningful lines of a TL;DR section: non-empty, and not the
 * template's bare `-` placeholder.
 *
 * @param {string} section - comment-stripped section content.
 * @returns {string[]}
 */
export function meaningfulLines(section) {
  return section
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && l !== "-");
}

/**
 * Validate that `body` contains a filled-in TL;DR section.
 * Pure and unit-testable — see tests/unit/tldr-block.test.ts.
 *
 * @param {string} body - the raw PR description.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateTldrBlock(body) {
  if (typeof body !== "string" || body.trim() === "") {
    return { ok: false, reason: "PR body is empty." };
  }

  const { found, section } = extractTldrSection(body);
  if (!found) {
    return { ok: false, reason: "Missing a `## TL;DR` heading in the PR body." };
  }

  if (meaningfulLines(section).length === 0) {
    return {
      ok: false,
      reason: "The `## TL;DR` section is empty or still contains only the template placeholder.",
    };
  }

  return { ok: true };
}

function main() {
  const result = validateTldrBlock(process.env.PR_BODY ?? "");
  if (result.ok) {
    console.log("✓ PR body carries a plain-language TL;DR.");
    process.exit(0);
  }
  console.error(`::error::TL;DR gate failed: ${result.reason} ${REMEDY}`);
  process.exit(1);
}

// Only run main() when executed directly, not when imported by the unit test
// (or by slack-merge-update.mjs, which imports the shared helpers above).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
