import { expect, test } from "@playwright/test";

import { openBrowseFilters } from "./helpers";

/**
 * Smoke test for the browse/directory route (#33, AUB-61 redesign). Open to
 * anonymous visitors. The test DB content is not assumed (it may be empty or
 * seeded), so we assert the directory chrome renders and EITHER listing cards OR
 * one of the honest empty/no-results states — never a fabricated count.
 *
 * The redesign moves the server-side sort + taxonomy filter behind the "Filters"
 * bottom sheet (the mobile header surfaces search + quick chips), so the sort/
 * filter tests open that sheet first via {@link openBrowseFilters}.
 */
test("browse directory renders for anonymous visitors", async ({ page }) => {
  await page.goto("/listings");

  // The always-present search field proves the directory rendered.
  await expect(page.getByRole("searchbox", { name: "Search listings" })).toBeVisible();

  // Either there are cards (a result list) or an honest empty/no-results heading.
  const resultsList = page.getByRole("list");
  const emptyState = page.getByRole("heading", {
    name: /Let's find your safe table|No spots match/,
  });
  await expect(resultsList.or(emptyState).first()).toBeVisible();
});

test("home Browse CTA navigates to the directory", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Browse Denver listings" }).click();
  await expect(page).toHaveURL(/\/listings/);
  await expect(page.getByRole("searchbox", { name: "Search listings" })).toBeVisible();
});

/**
 * Sort control (#36). The labeled `<select>` lives in the Filters sheet; choosing
 * a sort drives the URL (`?sort=`) so the view stays linkable, mirroring the
 * `?page=`/`?attrs=` pattern. We assert the accessible labeled control and the
 * URL wiring; the page-reset on sort change is covered by unit tests.
 */
test("browse sort control is labeled and drives the URL", async ({ page }) => {
  await page.goto("/listings");
  await openBrowseFilters(page);

  const sort = page.getByLabel("Sort by");
  await expect(sort).toBeVisible();

  await sort.selectOption("trust");
  await expect(page).toHaveURL(/sort=trust/);

  await sort.selectOption("recency");
  await expect(page).toHaveURL(/sort=recency/);

  // Back to the default returns the list to alphabetical order.
  await sort.selectOption("alpha");
  await expect(page).toHaveURL(/sort=alpha/);
});

/**
 * Taxonomy filter (#35) and sort (#36) compose: applying a filter and then a
 * sort keeps BOTH params in the URL (they are orthogonal). Guards the merge of
 * the two parallel features. Both controls live in the Filters sheet now.
 */
test("filter and sort compose in the URL", async ({ page }) => {
  await page.goto("/listings");
  await openBrowseFilters(page);

  // Toggle the headline celiac-safe taxonomy filter (a labeled checkbox from #35).
  const celiacFilter = page.getByRole("checkbox", { name: "Celiac-safe" });
  await expect(celiacFilter).toBeVisible();

  // Use click(), not check(): the checkbox is a controlled input whose state is
  // derived from the URL, so toggling it fires a navigation that re-renders it.
  await celiacFilter.click();
  await expect(page).toHaveURL(/attrs=celiac_safe_vs_gluten_friendly/);

  // Now sort; the filter param must survive alongside the new sort param.
  await page.getByLabel("Sort by").selectOption("trust");
  await expect(page).toHaveURL(/sort=trust/);
  await expect(page).toHaveURL(/attrs=/);
});
