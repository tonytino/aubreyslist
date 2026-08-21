import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs script, no type declarations
import { validateReviewBlock } from "../../.github/scripts/check-review-block.mjs";

const ALWAYS_ON = ["correctness", "security", "conventions", "architecture"];

/** The canonical panel record from docs/agents/orchestration.md. */
const fullRecord = () =>
  [
    "## Adversarial review",
    "correctness: SHIP",
    "security: SHIP",
    "conventions: SHIP",
    "architecture: SHIP",
    "design: n/a",
    "accessibility: n/a",
    "copy: n/a",
    "performance: SHIP",
    "data: n/a",
    "overall: SHIP",
  ].join("\n");

describe("validateReviewBlock", () => {
  it("passes on the full panel record", () => {
    expect(validateReviewBlock(fullRecord())).toEqual({ ok: true });
  });

  it.each(ALWAYS_ON)("fails when the %s line is missing", (lens) => {
    const body = fullRecord()
      .split("\n")
      .filter((l) => !l.startsWith(`${lens}:`))
      .join("\n");
    const r = validateReviewBlock(body);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain(lens);
  });

  it("fails when overall is missing", () => {
    const body = fullRecord()
      .split("\n")
      .filter((l) => !l.startsWith("overall:"))
      .join("\n");
    const r = validateReviewBlock(body);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/overall/i);
  });

  it("fails on a legacy bare overall: SHIP with no per-lens lines", () => {
    const body = ["## Adversarial review", "overall: SHIP", "notes: clean."].join("\n");
    const r = validateReviewBlock(body);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/missing a SHIP token/i);
  });

  it("passes on the current escalation marker", () => {
    const body = [
      "## Adversarial review",
      "",
      "## Unresolved review items (escalated after review cap)",
      "- **[major] security/authz** — worker rebutted; reviewer unconvinced.",
    ].join("\n");
    expect(validateReviewBlock(body)).toEqual({ ok: true });
  });

  it("passes on the legacy escalation marker", () => {
    const body = [
      "## Adversarial review",
      "",
      "## Unresolved review items (escalated after 2-round cap)",
      "- **[major] correctness** — edge case still contested.",
    ].join("\n");
    expect(validateReviewBlock(body)).toEqual({ ok: true });
  });

  it("does not let n/a satisfy an always-on lens", () => {
    const body = fullRecord().replace("correctness: SHIP", "correctness: n/a");
    const r = validateReviewBlock(body);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("correctness");
  });

  it("tolerates JSON, bold, and quoted token forms per lens", () => {
    const body = [
      "## Adversarial review",
      '"correctness": "SHIP"',
      "**security**: SHIP",
      "**conventions: SHIP**",
      "'architecture': 'SHIP'",
      "**overall**: SHIP",
    ].join("\n");
    expect(validateReviewBlock(body)).toEqual({ ok: true });
  });

  it("is case-insensitive on the heading and the tokens", () => {
    const body = [
      "### ADVERSARIAL REVIEW",
      "Correctness:   Ship",
      "SECURITY: ship",
      "Conventions: SHIP",
      "Architecture: SHIP",
      "Overall: Ship",
    ].join("\n");
    expect(validateReviewBlock(body)).toEqual({ ok: true });
  });

  it("fails on SHIP-prefixed words (word boundary)", () => {
    expect(validateReviewBlock(fullRecord().replace("overall: SHIP", "overall: SHIPPED")).ok).toBe(
      false
    );
    expect(
      validateReviewBlock(fullRecord().replace("correctness: SHIP", "correctness: SHIP-NOT")).ok
    ).toBe(false);
  });

  it("fails when the heading is missing", () => {
    const body = ["## Summary", fullRecord().split("\n").slice(1).join("\n")].join("\n");
    const r = validateReviewBlock(body);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/heading/i);
  });

  it("fails on the empty/placeholder template section", () => {
    const body = ["## Adversarial review", "<!-- Paste the panel record ... -->", "", "-"].join(
      "\n"
    );
    const r = validateReviewBlock(body);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/empty|placeholder/i);
  });

  it("fails on an empty body", () => {
    expect(validateReviewBlock("").ok).toBe(false);
    expect(validateReviewBlock("   ").ok).toBe(false);
  });

  it("does not let tokens outside the section satisfy the gate", () => {
    const record = fullRecord().split("\n").slice(1).join("\n");
    const body = ["## Summary", record, "", "## Adversarial review", "-"].join("\n");
    expect(validateReviewBlock(body).ok).toBe(false);
  });
});
