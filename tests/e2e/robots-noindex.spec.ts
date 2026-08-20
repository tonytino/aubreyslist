import { expect, test } from "@playwright/test";

/**
 * Robots and noindex verification.
 *
 * robots.txt must exist with proper crawl directives; internal routes
 * (/style-guide, /admin, /favorites) must carry noindex,nofollow meta.
 */

test("robots.txt exists and includes sitemap reference", async ({ page }) => {
  const response = await page.request.get("/robots.txt");
  expect(response.status()).toBe(200);

  const content = await response.text();
  // Should disallow admin and style-guide
  expect(content).toContain("Disallow: /admin");
  expect(content).toContain("Disallow: /style-guide");
  // Should disallow favorites (user-specific)
  expect(content).toContain("Disallow: /favorites");
  // Should disallow API endpoints
  expect(content).toContain("Disallow: /api/");
  // Should reference sitemap
  expect(content).toContain("Sitemap: https://www.aubreys-list.com/sitemap.xml");
});

test("/style-guide has noindex,nofollow meta tag", async ({ page }) => {
  await page.goto("/style-guide");
  const robotsMeta = page.locator('meta[name="robots"]');
  await expect(robotsMeta).toHaveAttribute("content", "noindex,nofollow");
});

test("/favorites has noindex,nofollow meta tag", async ({ page }) => {
  await page.goto("/favorites");
  const robotsMeta = page.locator('meta[name="robots"]');
  await expect(robotsMeta).toHaveAttribute("content", "noindex,nofollow");
});
