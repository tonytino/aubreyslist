import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs script, no type declarations
import { validateReviewBlock } from "../../.github/scripts/check-review-block.mjs";

describe("validateReviewBlock", () => {
  it("passes on a SHIP verdict block", () => {
    const body = [
      "## Summary",
      "- did a thing",
      "",
      "## Adversarial review",
      "overall: SHIP",
      "notes: clean after round 1.",
    ].join("\n");
    expect(validateReviewBlock(body)).toEqual({ ok: true });
  });

  it("passes on the VERBATIM orchestration.md JSON verdict block", () => {
    // Exactly the fenced verdict from docs/agents/orchestration.md (quoted key
    // and value) pasted inside the section. This is the canonical Reviewer output.
    const body = [
      "## Adversarial review",
      "",
      "```json",
      "{",
      '  "findings": [],',
      '  "overall": "SHIP",',
      '  "notes": "clean."',
      "}",
      "```",
    ].join("\n");
    expect(validateReviewBlock(body)).toEqual({ ok: true });
  });

  it("passes on the VERBATIM orchestration.md escalation `##` heading after the section", () => {
    // orchestration.md documents the escalation block as its own h2 heading. It
    // is pasted as a SIBLING of `## Adversarial review`, so the section boundary
    // cuts it off — but the marker is matched body-wide and must still validate.
    const body = [
      "## Adversarial review",
      "",
      "## Unresolved review items (escalated after 2-round cap)",
      "- **[major] correctness** — edge case. Worker's rebuttal: out of scope. Reviewer's concern: still risky.",
    ].join("\n");
    expect(validateReviewBlock(body)).toEqual({ ok: true });
  });

  it("passes on bold-emphasised verdicts", () => {
    expect(validateReviewBlock("## Adversarial review\n**overall**: SHIP").ok).toBe(true);
    expect(validateReviewBlock("## Adversarial review\n**overall: SHIP**").ok).toBe(true);
  });

  it("fails on a SHIP-prefixed word (word boundary)", () => {
    expect(validateReviewBlock("## Adversarial review\noverall: SHIPPED to prod").ok).toBe(false);
    expect(validateReviewBlock("## Adversarial review\noverall: SHIP-NOT").ok).toBe(false);
  });

  it("is case-insensitive on the heading and the verdict", () => {
    const body = ["### ADVERSARIAL REVIEW", "Overall:   Ship"].join("\n");
    expect(validateReviewBlock(body)).toEqual({ ok: true });
  });

  it("fails when the heading is missing", () => {
    const body = ["## Summary", "overall: SHIP"].join("\n");
    const r = validateReviewBlock(body);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/heading/i);
  });

  it("fails on the empty/placeholder template section", () => {
    const body = [
      "## Adversarial review",
      "<!-- Paste the fresh Reviewer's `overall: SHIP` verdict ... -->",
      "",
      "-",
    ].join("\n");
    const r = validateReviewBlock(body);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/empty|placeholder/i);
  });

  it("fails when the section has content but no verdict or escalation", () => {
    const body = ["## Adversarial review", "looked at it, seems fine to me"].join("\n");
    const r = validateReviewBlock(body);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no passing verdict/i);
  });

  it("fails on an empty body", () => {
    expect(validateReviewBlock("").ok).toBe(false);
    expect(validateReviewBlock("   ").ok).toBe(false);
  });

  it("does not let a SHIP token outside the section satisfy the gate", () => {
    const body = ["## Summary", "overall: SHIP", "## Adversarial review", "-"].join("\n");
    expect(validateReviewBlock(body).ok).toBe(false);
  });
});
