import { expect, test } from "@playwright/test";

test("home page renders server-function data", async ({ page }) => {
  await page.goto("/");

  // Assert the heading by role, so the test survives a project rename via
  // `pnpm scaffold` (no hard-coded title/text that scaffolding may change).
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // The loader's server-function `message` must actually render — this proves
  // SSR + the route loader + the server function all work end-to-end, not just
  // that some markup mounted.
  await expect(page.getByText("Hello from a server function")).toBeVisible();
});
