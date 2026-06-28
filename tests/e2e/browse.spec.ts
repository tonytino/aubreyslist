import { expect, test } from "@playwright/test";

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
