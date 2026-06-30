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

  it("passes on an escalation block", () => {
    const body = [
      "## Adversarial review",
      "## Unresolved review items (escalated after 2-round cap)",
      "- **[minor] docs** — wording. Worker's rebuttal: fine. Reviewer's concern: nit.",
    ].join("\n");
    // The escalation heading is shallower-or-equal? No — both are h2, so the
    // section under "Adversarial review" stops at the next h2. Keep the marker
    // INSIDE the section to assert detection.
    const inline = [
      "## Adversarial review",
      "Unresolved review items (escalated after 2-round cap)",
      "- **[minor] docs** — wording.",
    ].join("\n");
    expect(validateReviewBlock(inline)).toEqual({ ok: true });
    // The split-heading variant correctly does NOT count the sibling h2.
    expect(validateReviewBlock(body).ok).toBe(false);
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
