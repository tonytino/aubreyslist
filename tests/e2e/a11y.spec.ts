import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

/**
 * Accessibility gate (issue #192, part of #178).
 *
 * Accessibility is product-critical for a safety directory, so this spec asserts
 * ZERO axe-core violations on the public, DB-free pages of the app. It runs in
 * its own always-on CI lane (`.github/workflows/a11y.yml`) against `pnpm dev`
 * WITHOUT `DATABASE_URL`/`CI_E2E_DATABASE_URL`, so it gates every PR — unlike the
 * full E2E suite, which is hidden behind the optional `CI_E2E_DATABASE_URL`
 * secret (see `.github/workflows/ci.yml` → `integration-e2e`).
 *
 * SCOPE — only pages that render their REAL content WITHOUT auth or a DB:
 *   /            landing page (static component, no loader)
 *   /about       static marketing copy
 *   /style-guide static component gallery
 *
 * DELIBERATELY EXCLUDED — these need a live `DATABASE_URL` to render at all:
 *   /listings     its browse loader calls a server fn → `getDb()` → `getEnv()`,
 *                 which THROWS without `DATABASE_URL`; DB-free, the route renders
 *                 the router's default error component (a red
 *                 "Invalid environment variables: DATABASE_URL: Required" code
 *                 block), NOT the browse list. axe'ing that error page would be
 *                 auditing a fixture artifact, not the real page (and it self-
 *                 trips a color-contrast rule on the error text). Its real
 *                 content is covered by the DB-gated `browse.spec.ts`.
 *   /listings/new same: the loader (`getSetting` + `getCurrentUser`) hits the DB,
 *                 so DB-free it renders the same error component rather than the
 *                 add-listing form / sign-in prompt. Covered by `add-listing.spec.ts`
 *                 in the DB-gated lane.
 * Both were verified to render an error page (not their content) under `pnpm dev`
 * with no `DATABASE_URL`, mirroring how `browse.spec.ts`/`add-listing.spec.ts`
 * themselves only pass in the DB-gated `integration-e2e` lane. Auditing their
 * real, DB-backed accessibility belongs in that DB-gated lane, not this always-on
 * DB-free one. Authenticated/DB-seeded flows (admin, attest, report-incident,
 * listing-detail) are excluded for the same reason.
 *
 * RULE SET: `wcag2a` + `wcag2aa` — a deterministic, standards-based tag set so
 * the gate is stable across axe releases (no "best-practice"/experimental rules
 * that can flip on a version bump). On failure we print each violation's id and
 * the node targets so the report is actionable, then assert zero violations. We
 * do NOT disable rules or weaken the assertion to go green — a real violation is
 * a real a11y bug to fix (issue #192).
 */

const PUBLIC_DB_FREE_PAGES = ["/", "/about", "/style-guide"] as const;

const WCAG_TAGS = ["wcag2a", "wcag2aa"] as const;

/** Run axe on the current page and return a readable summary of any violations. */
async function analyze(page: Page) {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(" ")),
  }));
  return { violations: results.violations, summary };
}

for (const path of PUBLIC_DB_FREE_PAGES) {
  test(`a11y: ${path} has no WCAG 2 A/AA violations`, async ({ page }) => {
    await page.goto(path);
    // Let the route's loader/suspense settle so axe sees the hydrated DOM.
    await page.waitForLoadState("networkidle");

    const { violations, summary } = await analyze(page);

    if (violations.length > 0) {
      // Surface actionable detail (rule id + offending element targets) in the
      // test output so the report names exactly what to fix.
      console.error(`axe violations on ${path}:\n${JSON.stringify(summary, null, 2)}`);
    }

    expect(
      violations,
      `axe found ${violations.length} WCAG 2 A/AA violation(s) on ${path} — see console output above for rule ids and element targets`
    ).toEqual([]);
  });
}
