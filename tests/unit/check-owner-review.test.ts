import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs script, no type declarations
import * as detector from "../../.github/scripts/check-owner-review.mjs";
// @ts-expect-error — .mjs module, no type declarations
import * as policy from "../../.github/scripts/owner-review-paths.mjs";

const { matchCodeowners, isOwnedPath, parseUnifiedDiff, contentReasons, classifyOwnerReview } =
  detector;
const { OWNED_PATHS } = policy as { OWNED_PATHS: string[] };

describe("matchCodeowners — CODEOWNERS glob semantics", () => {
  it("matches a directory prefix (trailing slash)", () => {
    expect(matchCodeowners("/app/server/auth/", "app/server/auth/session.ts")).toBe(true);
    expect(matchCodeowners("/app/server/auth/", "app/server/authz.ts")).toBe(false);
  });

  it("matches an exact root-anchored file but not a nested one of the same name", () => {
    expect(matchCodeowners("/package.json", "package.json")).toBe(true);
    expect(matchCodeowners("/package.json", "packages/x/package.json")).toBe(false);
  });

  it("treats `*` as non-slash-crossing", () => {
    expect(matchCodeowners("/*.config.ts", "vite.config.ts")).toBe(true);
    expect(matchCodeowners("/*.config.ts", "vitest.config.ts")).toBe(true);
    expect(matchCodeowners("/*.config.ts", "app/nested.config.ts")).toBe(false);
    expect(matchCodeowners("/tsconfig*.json", "tsconfig.json")).toBe(true);
    expect(matchCodeowners("/tsconfig*.json", "tsconfig.node.json")).toBe(true);
  });

  it("treats `.` and `$` as literals, not regex metacharacters", () => {
    expect(matchCodeowners("/app/routes/api.$.ts", "app/routes/api.$.ts")).toBe(true);
    expect(matchCodeowners("/app/routes/api.$.ts", "app/routes/apiX.ts")).toBe(false);
  });
});

describe("isOwnedPath — the seven gated categories", () => {
  it.each([
    "app/server/places.ts", // cost
    "app/server/rate-limit/index.ts", // cost
    "app/server/auth/session.ts", // security
    "app/server/admin/set-role.ts", // security
    "app/env.ts", // secrets
    "app/server/incidents/incidents.ts", // trust & safety
    "app/server/moderation/hide.ts", // trust & safety
    "app/trust/summary.ts", // trust & safety
    "db/schema.ts", // PII
    "db/migrations/0006_x.sql", // PII / data
    "package.json", // supply chain
    "LICENSE", // legal
    "app/components/SiteFooter.tsx", // disclaimer home
    "app/routes/api.$.ts", // security chokepoint
    "vitest.config.ts", // CI-config surface
    "tsconfig.json", // CI-config surface
    ".github/workflows/ci.yml", // guardrail integrity
  ])("gates %s", (file) => {
    expect(isOwnedPath(file)).toBe(true);
  });

  it.each([
    "app/components/RestaurantCard.tsx",
    "app/server/listings/create.ts",
    "app/server/favorites/favorites.ts",
    "app/routes/about.tsx",
    "docs/agents/testing.md",
    "changelog.d/foo.added.md",
  ])("does NOT gate ordinary feature work: %s", (file) => {
    expect(isOwnedPath(file)).toBe(false);
  });
});

describe("parseUnifiedDiff", () => {
  it("attributes added/removed lines to the right file", () => {
    const diff = [
      "diff --git a/app/x.ts b/app/x.ts",
      "--- a/app/x.ts",
      "+++ b/app/x.ts",
      "@@ -1,1 +1,1 @@",
      "-old line",
      "+new line",
    ].join("\n");
    const entries = parseUnifiedDiff(diff);
    expect(entries).toContainEqual({ file: "app/x.ts", side: "add", text: "new line" });
    expect(entries).toContainEqual({ file: "app/x.ts", side: "del", text: "old line" });
  });

  it("uses the a-side path for a deletion (+++ /dev/null)", () => {
    const diff = ["--- a/app/gone.ts", "+++ /dev/null", "@@ -1 +0,0 @@", "-was here"].join("\n");
    expect(parseUnifiedDiff(diff)).toContainEqual({
      file: "app/gone.ts",
      side: "del",
      text: "was here",
    });
  });
});

describe("content checks — gated changes paths can't see", () => {
  it("flags a destructive migration only on added lines in db/migrations", () => {
    const diff = [
      "--- a/db/migrations/0006_x.sql",
      "+++ b/db/migrations/0006_x.sql",
      "@@ -0,0 +1 @@",
      '+ALTER TABLE "incidents" DROP COLUMN "note";',
    ].join("\n");
    const reasons = contentReasons(parseUnifiedDiff(diff));
    expect(reasons.map((r: { kind: string }) => r.kind)).toContain("destructive-migration");
  });

  it("does not flag destructive SQL that lives outside db/migrations", () => {
    const diff = ["--- a/docs/x.md", "+++ b/docs/x.md", "@@ +1 @@", "+run DROP TABLE users"].join(
      "\n"
    );
    const kinds = contentReasons(parseUnifiedDiff(diff)).map((r: { kind: string }) => r.kind);
    expect(kinds).not.toContain("destructive-migration");
  });

  it("flags a change to the medical-advice disclaimer in ANY file (added or removed)", () => {
    const diff = [
      "--- a/app/routes/about.tsx",
      "+++ b/app/routes/about.tsx",
      "@@ -1 +1 @@",
      "-Community-contributed, not medical advice.",
      "+Community-contributed guidance.",
    ].join("\n");
    const kinds = contentReasons(parseUnifiedDiff(diff)).map((r: { kind: string }) => r.kind);
    expect(kinds).toContain("safety-disclaimer");
  });

  it("flags a telemetry/PII posture change", () => {
    const diff = [
      "--- a/app/obs.ts",
      "+++ b/app/obs.ts",
      "@@ +1 @@",
      "+  sendDefaultPii: true,",
    ].join("\n");
    const kinds = contentReasons(parseUnifiedDiff(diff)).map((r: { kind: string }) => r.kind);
    expect(kinds).toContain("telemetry-privacy");
  });
});

describe("classifyOwnerReview — the gate", () => {
  it("fails an owner-gated path labeled safe:agent", () => {
    const r = classifyOwnerReview({
      changedFiles: ["app/server/places.ts"],
      labels: ["type:feature", "size:s", "safe:agent"],
    });
    expect(r.requiresOwner).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("passes the same change once relabeled safe:human", () => {
    const r = classifyOwnerReview({
      changedFiles: ["app/server/places.ts"],
      labels: ["type:feature", "size:s", "safe:human"],
    });
    expect(r.requiresOwner).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("fails a destructive migration labeled safe:agent (content-based)", () => {
    const diff = [
      "--- a/db/migrations/0006_x.sql",
      "+++ b/db/migrations/0006_x.sql",
      "@@ +1 @@",
      '+DROP TABLE "incidents";',
    ].join("\n");
    const r = classifyOwnerReview({
      changedFiles: ["db/migrations/0006_x.sql"],
      diffText: diff,
      labels: ["safe:agent"],
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x: { kind: string }) => x.kind === "destructive-migration")).toBe(true);
  });

  it("passes ordinary feature work labeled safe:agent (no owner review needed)", () => {
    const r = classifyOwnerReview({
      changedFiles: ["app/components/RestaurantCard.tsx"],
      labels: ["safe:agent"],
    });
    expect(r.requiresOwner).toBe(false);
    expect(r.ok).toBe(true);
  });
});

describe("drift guard — CODEOWNERS and the policy module never diverge", () => {
  it("has identical path sets in .github/CODEOWNERS and OWNED_PATHS (bidirectional)", () => {
    // Vitest's root is the repo root, so resolve from cwd (works in CI too).
    const codeownersPath = join(process.cwd(), ".github/CODEOWNERS");
    const codeownersTokens = readFileSync(codeownersPath, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"))
      .map((l) => l.split(/\s+/)[0] ?? "");

    const codeownersSet = new Set(codeownersTokens);
    const policySet = new Set(OWNED_PATHS);

    // Every CODEOWNERS entry is known to the detector...
    for (const token of codeownersSet) expect(policySet.has(token)).toBe(true);
    // ...and every policy path is actually gated in CODEOWNERS.
    for (const token of policySet) expect(codeownersSet.has(token)).toBe(true);
    expect(codeownersSet.size).toBe(policySet.size);
  });
});
