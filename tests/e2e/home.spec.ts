import { expect, test } from "@playwright/test";

test("home page renders the app shell header, brand, and nav", async ({ page }) => {
  await page.goto("/");

  // The header app shell renders with the brand wordmark (#91), reachable via
  // the home link by its accessible name.
  const header = page.getByRole("banner");
  await expect(header).toBeVisible();
  const homeLink = header.getByRole("link", { name: "Aubrey's List home" });
  await expect(homeLink).toBeVisible();
  await expect(homeLink).toHaveAttribute("href", "/");

  // Primary navigation renders inside the header, and each item points at its
  // real route (#96) so the active state is accurate.
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Browse" })).toHaveAttribute("href", "/listings");
  await expect(nav.getByRole("link", { name: "Add a listing" })).toHaveAttribute(
    "href",
    "/listings/new"
  );

  // The sign-in entry point renders as the "Continue with Google" link for an
  // anonymous visitor (Google is the sole provider — ADR-006).
  await expect(header.getByRole("link", { name: "Continue with Google" })).toBeVisible();

  // The landing page hero renders its mission heading.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
