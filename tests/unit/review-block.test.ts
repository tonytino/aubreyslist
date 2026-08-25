import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs script, no type declarations
import { routeLenses, validateReviewBlock } from "../../.github/scripts/check-review-block.mjs";

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

describe("routeLenses", () => {
  it("routes the reduced panel when every changed file is prose", () => {
    expect(
      routeLenses(["README.md", "docs/onboarding.md", "changelog.d/1.added.md", "LICENSE"])
    ).toEqual(["conventions", "copy"]);
  });

  it("routes the full panel as soon as one file is not prose", () => {
    const routed = routeLenses(["README.md", "app/lib/slugify.ts"]);
    for (const lens of ALWAYS_ON) expect(routed).toContain(lens);
    // The prose file still routes copy; nothing else conditional matches.
    expect(routed).toContain("copy");
    expect(routed).not.toContain("design");
    expect(routed).not.toContain("data");
  });

  it("routes the full panel for an unrecognised top-level path (allowlist, not blocklist)", () => {
    const routed = routeLenses(["telemetry/collector.go"]);
    expect(routed).toEqual(ALWAYS_ON);
  });

  it("routes the full panel for an empty changed-file list", () => {
    expect(routeLenses([])).toEqual(ALWAYS_ON);
    expect(routeLenses(undefined)).toEqual(ALWAYS_ON);
  });

  it.each([
    "AGENTS.md",
    "CLAUDE.md",
    "docs/agents/orchestration.md",
    "docs/decisions/015-owner-review-guardrails.md",
    ".claude/workflows/x.mjs",
  ])("treats %s as binding, not prose", (file) => {
    const routed = routeLenses([file]);
    for (const lens of ALWAYS_ON) expect(routed).toContain(lens);
  });

  it("routes design, accessibility, and copy for UI paths", () => {
    for (const file of ["app/components/card.tsx", "app/routes/index.tsx", "app/app.css"]) {
      const routed = routeLenses([file]);
      expect(routed).toContain("design");
      expect(routed).toContain("accessibility");
      expect(routed).toContain("copy");
    }
  });

  it("routes performance and data for db paths", () => {
    const routed = routeLenses(["db/schema.ts"]);
    expect(routed).toContain("performance");
    expect(routed).toContain("data");
    expect(routed).not.toContain("design");
  });
});

describe("validateReviewBlock", () => {
  it("passes on the full panel record", () => {
    expect(validateReviewBlock(fullRecord(), ALWAYS_ON)).toEqual({ ok: true });
  });

  it.each(ALWAYS_ON)("fails when the %s line is missing", (lens) => {
    const body = fullRecord()
      .split("\n")
      .filter((l) => !l.startsWith(`${lens}:`))
      .join("\n");
    const r = validateReviewBlock(body, ALWAYS_ON);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain(lens);
  });

  it("fails when overall is missing", () => {
    const body = fullRecord()
      .split("\n")
      .filter((l) => !l.startsWith("overall:"))
      .join("\n");
    const r = validateReviewBlock(body, ALWAYS_ON);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/overall/i);
  });

  it("fails on a legacy bare overall: SHIP with no per-lens lines", () => {
    const body = ["## Adversarial review", "overall: SHIP", "notes: clean."].join("\n");
    const r = validateReviewBlock(body, ALWAYS_ON);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no verdict token for correctness/i);
  });

  it("passes on the current escalation marker when every routed lens has a verdict", () => {
    const body = [
      "## Adversarial review",
      "correctness: SHIP",
      "security: CHANGES_REQUESTED",
      "conventions: SHIP",
      "architecture: SHIP",
      "overall: CHANGES_REQUESTED",
      "",
      "## Unresolved review items (escalated after review cap)",
      "- **[major] security/authz** — worker rebutted; reviewer unconvinced.",
    ].join("\n");
    expect(validateReviewBlock(body, ALWAYS_ON)).toEqual({ ok: true });
  });

  it("passes on the legacy escalation marker when every routed lens has a verdict", () => {
    const body = [
      "## Adversarial review",
      "correctness: CHANGES_REQUESTED",
      "security: SHIP",
      "conventions: SHIP",
      "architecture: SHIP",
      "overall: CHANGES_REQUESTED",
      "",
      "## Unresolved review items (escalated after 2-round cap)",
      "- **[major] correctness** — edge case still contested.",
    ].join("\n");
    expect(validateReviewBlock(body, ALWAYS_ON)).toEqual({ ok: true });
  });

  it("passes when the marker is present and every routed lens is CHANGES_REQUESTED", () => {
    const body = [
      "## Adversarial review",
      ...ALWAYS_ON.map((lens) => `${lens}: CHANGES_REQUESTED`),
      "overall: CHANGES_REQUESTED",
      "",
      "## Unresolved review items (escalated after review cap)",
      "- **[blocker] architecture** — layering still contested.",
    ].join("\n");
    expect(validateReviewBlock(body, ALWAYS_ON)).toEqual({ ok: true });
  });

  it("fails a routed lens with no verdict even when the marker is present", () => {
    const body = [
      "## Adversarial review",
      "correctness: SHIP",
      "security: SHIP",
      "conventions: SHIP",
      "overall: CHANGES_REQUESTED",
      "",
      "## Unresolved review items (escalated after review cap)",
      "- **[major] correctness** — contested.",
    ].join("\n");
    const r = validateReviewBlock(body, ALWAYS_ON);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("architecture");
    expect(r.reason).not.toContain("correctness:");
  });

  it("fails a routed conditional lens recorded n/a", () => {
    const routed = [...ALWAYS_ON, "design"];
    const r = validateReviewBlock(fullRecord(), routed);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("design");
    expect(r.reason).toMatch(/n\/a/i);
  });

  it("fails CHANGES_REQUESTED with no escalation marker", () => {
    const body = fullRecord().replace("security: SHIP", "security: CHANGES_REQUESTED");
    const r = validateReviewBlock(body, ALWAYS_ON);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("security");
    expect(r.reason).toMatch(/escalation/i);
  });

  it("lets a non-routed lens be absent entirely", () => {
    const body = [
      "## Adversarial review",
      ...ALWAYS_ON.map((lens) => `${lens}: SHIP`),
      "overall: SHIP",
    ].join("\n");
    expect(validateReviewBlock(body, ALWAYS_ON)).toEqual({ ok: true });
  });

  it("passes the reduced prose panel", () => {
    const body = ["## Adversarial review", "conventions: SHIP", "copy: SHIP", "overall: SHIP"].join(
      "\n"
    );
    expect(validateReviewBlock(body, routeLenses(["docs/onboarding.md"]))).toEqual({ ok: true });
  });

  it("does not let a longer word satisfy a lens token", () => {
    const body = [
      "## Adversarial review",
      ...ALWAYS_ON.map((lens) => `${lens}: SHIP`),
      "metadata: SHIP",
      "overall: SHIP",
    ].join("\n");
    const r = validateReviewBlock(body, [...ALWAYS_ON, "data"]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("data");
  });

  it("does not let n/a satisfy an always-on lens", () => {
    const body = fullRecord().replace("correctness: SHIP", "correctness: n/a");
    const r = validateReviewBlock(body, ALWAYS_ON);
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
    expect(validateReviewBlock(body, ALWAYS_ON)).toEqual({ ok: true });
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
    expect(validateReviewBlock(body, ALWAYS_ON)).toEqual({ ok: true });
  });

  it("fails on SHIP-prefixed words (word boundary)", () => {
    expect(
      validateReviewBlock(fullRecord().replace("overall: SHIP", "overall: SHIPPED"), ALWAYS_ON).ok
    ).toBe(false);
    expect(
      validateReviewBlock(
        fullRecord().replace("correctness: SHIP", "correctness: SHIP-NOT"),
        ALWAYS_ON
      ).ok
    ).toBe(false);
  });

  it("fails when the heading is missing", () => {
    const body = ["## Summary", fullRecord().split("\n").slice(1).join("\n")].join("\n");
    const r = validateReviewBlock(body, ALWAYS_ON);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/heading/i);
  });

  it("fails on the empty/placeholder template section", () => {
    const body = ["## Adversarial review", "<!-- Paste the panel record ... -->", "", "-"].join(
      "\n"
    );
    const r = validateReviewBlock(body, ALWAYS_ON);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/empty|placeholder/i);
  });

  it("fails on an empty body", () => {
    expect(validateReviewBlock("", ALWAYS_ON).ok).toBe(false);
    expect(validateReviewBlock("   ", ALWAYS_ON).ok).toBe(false);
  });

  it("does not let tokens outside the section satisfy the gate", () => {
    const record = fullRecord().split("\n").slice(1).join("\n");
    const body = ["## Summary", record, "", "## Adversarial review", "-"].join("\n");
    expect(validateReviewBlock(body, ALWAYS_ON).ok).toBe(false);
  });
});
