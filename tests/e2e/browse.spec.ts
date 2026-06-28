import { expect, test } from "@playwright/test";

import { waitForBrowseReady } from "./helpers";

/**
 * Smoke test for the browse-list route (#33). Open to anonymous visitors. The
 * test DB content is not assumed (it may be empty or seeded), so we assert the
 * page renders its heading and EITHER listing cards OR the honest empty state —
 * never a fabricated count.
 */
test("browse listings page renders for anonymous visitors", async ({ page }) => {
  await page.goto("/listings");

  await expect(
    page.getByRole("heading", { name: "Browse Denver listings", level: 1 })
  ).toBeVisible();

  // Either there are cards (a result list) or the honest empty state.
  const resultsList = page.getByRole("list");
  const emptyState = page.getByRole("heading", { name: "No listings yet" });
  await expect(resultsList.or(emptyState).first()).toBeVisible();
});

test("home Browse CTA navigates to the browse list", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Browse Denver listings" }).click();
  await expect(page).toHaveURL(/\/listings/);
  await expect(
    page.getByRole("heading", { name: "Browse Denver listings", level: 1 })
  ).toBeVisible();
});

/**
 * Sort control (#36). The labeled `<select>` is rendered by the browse route;
 * choosing a sort drives the URL (`?sort=`) so the view is linkable, mirroring
 * the `?page=`/`?attrs=` pattern. We assert the accessible labeled control and
 * the URL wiring; the page-reset on sort change is covered by unit tests.
 */
test("browse sort control is labeled and drives the URL", async ({ page }) => {
  await page.goto("/listings");

  const sort = page.getByLabel("Sort by");
  await expect(sort).toBeVisible();

  // Wait for hydration AND the route's initial search-param canonicalization
  // before interacting: the <select>'s onChange only writes the URL once the
  // client bundle runs, and selecting during the post-hydration canonicalizing
  // navigation gets clobbered back to the default. See waitForBrowseReady.
  await waitForBrowseReady(page);

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
 * the two parallel features.
 */
test("filter and sort compose in the URL", async ({ page }) => {
  await page.goto("/listings");

  // Toggle the headline celiac-safe taxonomy filter (a labeled checkbox from #35).
  const celiacFilter = page.getByRole("checkbox", {
    name: "Celiac-safe vs. gluten-friendly",
  });
  await expect(celiacFilter).toBeVisible();

  // Wait for hydration AND the route's initial search-param canonicalization
  // before interacting: the checkbox's onChange only writes the URL once the
  // client bundle runs, and checking during the post-hydration canonicalizing
  // navigation gets clobbered. See waitForBrowseReady.
  await waitForBrowseReady(page);

  // Use click(), not check(): the checkbox is a controlled input whose state is
  // derived from the URL, so toggling it fires a navigation that re-renders it.
  // Playwright's check() asserts the resulting `checked` state synchronously after
  // the click and races that controlled re-render (it can momentarily read the
  // pre-navigation value); click() just performs the toggle and lets the URL
  // assertion below be the source of truth.
  await celiacFilter.click();
  await expect(page).toHaveURL(/attrs=celiac_safe_vs_gluten_friendly/);

  // Now sort; the filter param must survive alongside the new sort param.
  await page.getByLabel("Sort by").selectOption("trust");
  await expect(page).toHaveURL(/sort=trust/);
  await expect(page).toHaveURL(/attrs=/);
});
