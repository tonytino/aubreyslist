import { expect, test } from "@playwright/test";

import { runAxeScan, waitForHydration } from "./helpers";

/**
 * Accessibility gate.
 *
 * Accessibility is product-critical for a safety directory, so this spec
 * asserts zero axe-core violations on the public, DB-free pages of the app. It
 * runs in its own always-on CI lane (`.github/workflows/a11y.yml`) against
 * `pnpm dev` without `DATABASE_URL`/`CI_E2E_DATABASE_URL`, so it gates every
 * PR — unlike the full E2E suite, which is hidden behind the optional
 * `CI_E2E_DATABASE_URL` secret (see `.github/workflows/ci.yml` →
 * `integration-e2e`).
 *
 * Scope — only pages that render their real content without auth or a DB:
 *   /about       static marketing copy
 *   /style-guide static component gallery
 *
 * Deliberately excluded — these need a live `DATABASE_URL` to render at all:
 *   /             the Denver directory is the home page; its browse loader
 *                 calls a server fn → `getDb()` → `getEnv()`, which throws
 *                 without `DATABASE_URL`. DB-free, the route renders the
 *                 router's default error component, not the directory. axe'ing
 *                 that error page would be auditing a fixture artifact, not
 *                 the real page (and it self-trips a color-contrast rule on
 *                 the error text). Its real content is covered by the DB-gated
 *                 `browse.spec.ts`.
 *   /listings     permanently redirects to `/` — same DB dependency once it
 *                 lands on the directory. Covered by the DB-gated
 *                 `browse.spec.ts`.
 *   /listings/new same: the loader (`getSetting` + `getCurrentUser`) hits the
 *                 DB, so DB-free it renders the same error component rather
 *                 than the add-listing form / sign-in prompt. Covered by
 *                 `add-listing.spec.ts` in the DB-gated lane.
 * Auditing their real, DB-backed accessibility belongs in the DB-gated lane,
 * not this always-on DB-free one. Authenticated/DB-seeded flows (admin,
 * attest, report-incident, listing-detail) are excluded for the same reason.
 *
 * Rule set: `WCAG_TAGS` from `./helpers` (see its doc for why not the 2.1
 * tags). On failure we print each violation's id and the node targets so the
 * report is actionable, then assert zero violations. Never disable rules or
 * weaken the assertion to go green — a real violation is a real a11y bug to
 * fix.
 */

const PUBLIC_DB_FREE_PAGES = ["/about", "/style-guide"] as const;

for (const path of PUBLIC_DB_FREE_PAGES) {
  test(`a11y: ${path} has no WCAG 2 A/AA violations`, async ({ page }) => {
    await page.goto(path);
    // Let the route's loader/suspense settle so axe sees the hydrated DOM.
    await page.waitForLoadState("networkidle");

    const { violations, summary } = await runAxeScan(page);

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

/**
 * Mobile header coverage. The loop above runs at the ~1280px default width,
 * where the responsive header shows its `sm:`+ split layout and the combined
 * `SiteMenu` is `sm:hidden` — so its portaled dropdown gets zero axe coverage
 * there. Below `sm` (375px, the minimum supported width) the header collapses
 * into that single combined menu, so we scan it both closed (mobile header
 * chrome) and open (the portaled Navigate + Account panel is in the DOM).
 * `/about` is the DB-free page that renders the real header signed-out, so it
 * works in this always-on lane.
 */
test.describe("mobile header (375px)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("a11y: mobile header + open combined menu have no WCAG 2 A/AA violations", async ({
    page,
  }) => {
    await page.goto("/about");
    await page.waitForLoadState("networkidle");

    // (a) Closed mobile header chrome.
    {
      const { violations, summary } = await runAxeScan(page);
      if (violations.length > 0) {
        console.error(
          `axe violations on /about (375px, menu closed):\n${JSON.stringify(summary, null, 2)}`
        );
      }
      expect(
        violations,
        `axe found ${violations.length} WCAG 2 A/AA violation(s) on the closed mobile header — see console output above`
      ).toEqual([]);
    }

    // (b) Open the combined menu (portals its Navigate + Account content into the
    // DOM) and re-scan. The trigger only opens after hydration.
    await waitForHydration(page);
    const nav = page.getByRole("navigation", { name: "Primary" });
    await nav.getByRole("button", { name: "Open menu" }).click();
    // Wait for the portaled panel to be present before scanning.
    await expect(page.getByRole("menuitem", { name: "Browse" })).toBeVisible();

    {
      const { violations, summary } = await runAxeScan(page);
      if (violations.length > 0) {
        console.error(
          `axe violations on /about (375px, menu open):\n${JSON.stringify(summary, null, 2)}`
        );
      }
      expect(
        violations,
        `axe found ${violations.length} WCAG 2 A/AA violation(s) on the open combined menu — see console output above`
      ).toEqual([]);
    }
  });
});
