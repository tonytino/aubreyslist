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

  // Primary navigation is a hamburger menu at every breakpoint (mobile-first).
  // The landmark + trigger render server-side; the menu's items (covered by the
  // SiteHeader unit test) live in a portaled dropdown, so we assert the trigger
  // here rather than opening the menu (which would depend on hydration).
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button", { name: "Open menu" })).toBeVisible();

  // The sign-in entry point renders as the compact "Log in" link for an
  // anonymous visitor (Google is the sole provider — ADR-006).
  await expect(header.getByRole("link", { name: "Log in" })).toBeVisible();

  // The landing page hero renders its mission heading.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
