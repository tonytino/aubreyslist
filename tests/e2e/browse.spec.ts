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
  // The directory is the home page now (AUB-116).
  await page.goto("/");

  // The search now leads the filter chip row as a collapsed chip (user feedback
  // #5); its presence proves the directory chrome rendered.
  await expect(page.getByRole("button", { name: "Search restaurants" })).toBeVisible();

  // Either there are cards (a result list) or an honest empty/no-results heading.
  const resultsList = page.getByRole("list");
  const emptyState = page.getByRole("heading", {
    name: /Let's find your safe table|No spots match/,
  });
  await expect(resultsList.or(emptyState).first()).toBeVisible();
});

test("/listings redirects to the directory at /", async ({ page }) => {
  // The old directory URL now permanently redirects to `/` (AUB-116). The
  // beforeLoad redirect forwards the validated search, but `stripSearchParams` on
  // the target route drops every param equal to its default, so a bare `/listings`
  // lands on a clean `/`. Tolerate either a bare `/` or a trailing query string.
  await page.goto("/listings");
  await expect(page).toHaveURL(/^[^?]*\/(\?|$)/);
  await expect(page).not.toHaveURL(/\/listings/);
  await expect(page.getByRole("button", { name: "Search restaurants" })).toBeVisible();
});

test("/listings redirect preserves search params", async ({ page }) => {
  // A shared `/listings?…` link keeps its params through the redirect to `/`
  // (routing.md smoke-test guidance).
  await page.goto("/listings?page=2&sort=trust");
  await expect(page).toHaveURL(/^[^?]*\/\?/);
  await expect(page).not.toHaveURL(/\/listings/);
  await expect(page).toHaveURL(/page=2/);
  await expect(page).toHaveURL(/sort=trust/);
});

/**
 * Sort control (#36). The labeled `<select>` lives in the Filters sheet; choosing
 * a sort drives the URL (`?sort=`) so the view stays linkable, mirroring the
 * `?page=`/`?attrs=` pattern. We assert the accessible labeled control and the
 * URL wiring; the page-reset on sort change is covered by unit tests.
 */
test("browse sort control is labeled and drives the URL", async ({ page }) => {
  await page.goto("/");
  await openBrowseFilters(page);

  const sort = page.getByLabel("Sort by");
  await expect(sort).toBeVisible();

  await sort.selectOption("trust");
  await expect(page).toHaveURL(/sort=trust/);

  await sort.selectOption("recency");
  await expect(page).toHaveURL(/sort=recency/);

  // Back to the default returns the list to alphabetical order AND strips `sort`
  // from the URL entirely (stripSearchParams drops any param equal to its default),
  // so the bar reads as a clean `/` rather than carrying redundant `?sort=alpha`.
  await sort.selectOption("alpha");
  await expect(page).not.toHaveURL(/sort=/);
});

/**
 * Taxonomy filter (#35) and sort (#36) compose: applying a filter and then a
 * sort keeps BOTH params in the URL (they are orthogonal). Guards the merge of
 * the two parallel features. Both controls live in the Filters sheet now.
 */
test("filter and sort compose in the URL", async ({ page }) => {
  await page.goto("/");
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
