import { expect, test } from "@playwright/test";

import { waitForHydration } from "./helpers";

// Exercise the mobile layout: below `sm` (640px) the header collapses the nav +
// account controls into one right-anchored combined menu. 375px is the minimum
// supported width (docs/agents/styling.md).
test.use({ viewport: { width: 375, height: 812 } });

test("home page renders the app shell header, brand, and combined menu", async ({ page }) => {
  // `/` is the Denver directory. This test asserts the app-shell chrome; the
  // directory content itself is covered by browse.spec.ts.
  await page.goto("/");

  // The header app shell renders with the brand wordmark, reachable via the
  // home link by its accessible name.
  const header = page.getByRole("banner");
  await expect(header).toBeVisible();
  const homeLink = header.getByRole("link", { name: "Aubrey's List home" });
  await expect(homeLink).toBeVisible();
  await expect(homeLink).toHaveAttribute("href", "/");

  // Below `sm`, primary navigation folds into a single right-anchored combined
  // menu whose trigger reads as a menu. The `<nav aria-label="Primary">`
  // landmark wraps the trigger so the navigation landmark persists; the items
  // live in a portaled dropdown that only opens after hydration.
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  const menuTrigger = nav.getByRole("button", { name: "Open menu" });
  await expect(menuTrigger).toBeVisible();

  // The sign-in entry point sits inside the combined menu (Account section)
  // for an anonymous visitor — open the menu, then assert it (Google is the
  // sole provider — ADR-006).
  await waitForHydration(page);
  await menuTrigger.click();
  await expect(page.getByRole("menuitem", { name: "Log in" })).toBeVisible();
  // The primary nav items live in the same menu's Navigate section.
  await expect(page.getByRole("menuitem", { name: "Browse" })).toBeVisible();

  // The directory chrome renders at `/`: the search chip that leads the filter
  // row proves the directory (not a marketing hero) mounted here.
  await expect(page.getByRole("button", { name: "Search restaurants" })).toBeVisible();

  // Either there are cards (a result list) or an honest empty/no-results heading —
  // never a fabricated count.
  const resultsList = page.getByRole("list");
  const emptyState = page.getByRole("heading", {
    name: /Let's find your safe table|No spots match/,
  });
  await expect(resultsList.or(emptyState).first()).toBeVisible();
});
