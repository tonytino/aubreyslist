import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs script, no type declarations
import { validateTldrBlock } from "../../.github/scripts/check-tldr-block.mjs";

describe("validateTldrBlock", () => {
  it("passes on a filled-in TL;DR section", () => {
    const body = [
      "## TL;DR",
      "People can now save their favorite restaurants and find them again later.",
      "",
      "## Summary",
      "- added favorites table + server fns",
    ].join("\n");
    expect(validateTldrBlock(body)).toEqual({ ok: true });
  });

  it("passes on the template shape once the placeholder is replaced", () => {
    // Exactly what a filled-in .github/pull_request_template.md looks like:
    // instruction comment still present, placeholder `-` replaced with prose.
    const body = [
      "## TL;DR",
      "<!-- 1–3 plain sentences that anyone in the business can understand -->",
      "",
      "- Searching is faster now, especially on phones.",
      "",
      "## Summary",
      "-",
    ].join("\n");
    expect(validateTldrBlock(body)).toEqual({ ok: true });
  });

  it("tolerates the TLDR and TL DR spelling variants", () => {
    expect(validateTldrBlock("## TLDR\nShipped a thing users can see.").ok).toBe(true);
    expect(validateTldrBlock("## TL DR\nShipped a thing users can see.").ok).toBe(true);
  });

  it("is case-insensitive and accepts any heading level", () => {
    expect(validateTldrBlock("# tl;dr\nA change people will notice.").ok).toBe(true);
    expect(validateTldrBlock("###### TL;DR\nA change people will notice.").ok).toBe(true);
  });

  it("tolerates trailing punctuation on the heading (## TL;DR:)", () => {
    expect(validateTldrBlock("## TL;DR:\nShipped a thing users can see.").ok).toBe(true);
  });

  it("fails when the heading is missing", () => {
    const body = ["## Summary", "- did a thing"].join("\n");
    const r = validateTldrBlock(body);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/heading/i);
  });

  it("does not treat a heading that merely contains TLDR as the section", () => {
    const r = validateTldrBlock("## Not a TLDR of anything\nsome text");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/heading/i);
  });

  it("fails on an empty section", () => {
    const body = ["## TL;DR", "", "## Summary", "- real content"].join("\n");
    const r = validateTldrBlock(body);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/empty|placeholder/i);
  });

  it("fails on a placeholder-only section (bare `-`)", () => {
    const body = ["## TL;DR", "-", "", "## Summary", "- real content"].join("\n");
    const r = validateTldrBlock(body);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/empty|placeholder/i);
  });

  it("fails when the section holds only the template's HTML comment", () => {
    const body = [
      "## TL;DR",
      "<!-- 1–3 plain sentences that anyone in the business can understand:",
      "what changed and why it matters. -->",
      "",
      "-",
      "",
      "## Summary",
      "- real content",
    ].join("\n");
    const r = validateTldrBlock(body);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/empty|placeholder/i);
  });

  it("does not count content after the next same-or-shallower heading", () => {
    const body = ["## TL;DR", "", "## Summary", "this belongs to Summary, not TL;DR"].join("\n");
    expect(validateTldrBlock(body).ok).toBe(false);
  });

  it("keeps content under a DEEPER sub-heading inside the section", () => {
    const body = ["## TL;DR", "### details", "Users get a nicer signup flow."].join("\n");
    expect(validateTldrBlock(body).ok).toBe(true);
  });

  it("ignores a TL;DR heading inside a fenced code block", () => {
    // The only "TL;DR heading" is sample text inside a fence — the gate must
    // not accept it (there is no real TL;DR to post to Slack).
    const body = [
      "## Summary",
      "```md",
      "## TL;DR",
      "this is a template example, not a real TL;DR",
      "```",
    ].join("\n");
    const r = validateTldrBlock(body);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/heading/i);
  });

  it("does not let a fenced pseudo-heading terminate the section early", () => {
    // The `## fake heading` lives inside a fence within the TL;DR section, so
    // the section runs past it and the real content after the fence counts.
    const body = [
      "## TL;DR",
      "```",
      "## fake heading inside a code sample",
      "```",
      "Users can now export their data.",
      "",
      "## Summary",
      "- real content",
    ].join("\n");
    expect(validateTldrBlock(body)).toEqual({ ok: true });
  });

  it("treats an UNCLOSED HTML comment as running to end of text (no content)", () => {
    const body = [
      "## TL;DR",
      "<!-- oops, this comment is never closed",
      "so none of this counts as content",
    ].join("\n");
    const r = validateTldrBlock(body);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/empty|placeholder/i);
  });

  it("fails on an empty body and on non-string input", () => {
    // The .mjs import is untyped, so non-string inputs can be exercised directly
    // (main() can receive an unset env var).
    expect(validateTldrBlock("").ok).toBe(false);
    expect(validateTldrBlock("   ").ok).toBe(false);
    expect(validateTldrBlock(undefined).ok).toBe(false);
    expect(validateTldrBlock(null).ok).toBe(false);
  });
});
