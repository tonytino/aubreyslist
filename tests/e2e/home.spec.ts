import { expect, test } from "@playwright/test";

test("home page renders the app shell header, brand, and nav", async ({ page }) => {
  await page.goto("/");

  // The header app shell renders with the brand wordmark placeholder.
  const header = page.getByRole("banner");
  await expect(header).toBeVisible();
  await expect(header.getByRole("link", { name: "Aubrey's List home" })).toBeVisible();

  // Primary navigation renders inside the header.
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Browse" })).toBeVisible();

  // The sign-in entry point renders as the "Continue with Google" link for an
  // anonymous visitor (Google is the sole provider — ADR-006).
  await expect(header.getByRole("link", { name: "Continue with Google" })).toBeVisible();

  // The landing page hero renders its mission heading.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
