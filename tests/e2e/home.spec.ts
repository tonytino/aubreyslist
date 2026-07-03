import { expect, test } from "@playwright/test";

test("home page renders the app shell header, brand, and nav", async ({ page }) => {
  // `/` IS the Denver directory now (AUB-116) — the standalone marketing landing
  // was retired. We still assert the app-shell chrome here; the directory content
  // itself is covered by browse.spec.ts.
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
