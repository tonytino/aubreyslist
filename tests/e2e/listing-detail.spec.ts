import { expect, test } from "@playwright/test";

// We assert the not-found path because it needs no seeded data: an id that
// cannot exist resolves to the route's notFoundComponent. The populated detail
// view is covered by component tests (SafetySummary, TrustPlaceholder) until
// EPIC 4 wires real listing data into E2E fixtures.
test("unknown listing id renders the not-found state", async ({ page }) => {
  await page.goto("/listings/does-not-exist");

  await expect(page.getByRole("heading", { name: "Listing not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to home" })).toBeVisible();
});
