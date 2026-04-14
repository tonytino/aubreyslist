import { expect, test } from "@playwright/test";

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/App/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
