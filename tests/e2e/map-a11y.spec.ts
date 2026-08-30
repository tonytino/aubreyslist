import { expect, type Locator, type Page, test } from "@playwright/test";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";
import { runAxeScan, waitForBrowseReady } from "./helpers";

/**
 * Directory map view (`?view=map`) accessibility + keyboard pass.
 *
 * This spec lives in the DB-backed chromium lane, not the DB-free a11y lane,
 * because its scans need seeded data.
 *
 * The map needs a real database: `/` errors without `DATABASE_URL` (see
 * a11y.spec.ts's exclusion note), and the map content area only mounts once
 * `vms.length > 0` (app/routes/index.tsx). This file seeds its own listing
 * and self-skips without the CI E2E database/session secret, like every
 * DB-touching spec (fixtures.ts's `E2E_DB_READY`).
 *
 * These scans complement, not replace, `a11y.spec.ts`'s always-on DB-free
 * lane: that lane gates every PR unconditionally on the public static pages;
 * this file adds seeded-data coverage of the one surface that lane cannot
 * reach, gated on the optional CI E2E database secret.
 *
 * Render path: this environment provisions no
 * `VITE_GOOGLE_MAPS_BROWSER_KEY`, so `?view=map` renders the CSS-placeholder
 * fallback (`DirectoryMap.tsx`'s `PlaceholderMap`), not the live Google
 * `<AdvancedMarker>` map (`DirectoryMapLive.tsx`). Both paths render the same
 * pin `<button>` and mini-card carousel from `map-ui.tsx`, so this coverage
 * applies unchanged either way.
 *
 * Sort: the directory's default sort is "distance", which degrades to the
 * recency fallback with no location signal — headless E2E has neither
 * geolocation nor a coarse IP anchor. An unconfirmed seeded listing sorts to
 * the tail there, not the front. Every test below navigates with an explicit
 * `?sort=alpha` so the seeded listing's leading-digit name (`0000-<token>
 * …`) genuinely sorts first (`app/server/listings/browse.ts`'s
 * `buildOrderBy`, alpha case: name ASC). A non-default sort survives
 * `stripSearchParams`, so the param round-trips.
 *
 * Locators: the pin's accessible name equals the listing name exactly (no
 * safety label on an unclaimed listing); the mini-card's starts with the
 * same name; the favourite button's starts with "Save"/"Saved, remove"
 * instead. `listingLocators` below matches on those names, not DOM position,
 * so a test can't bind to a different card even if ordering shifts.
 *
 * Theme: a visitor's choice lives in `localStorage.theme`, read by the
 * no-FOUC inline script in `app/routes/__root.tsx` before hydration. Setting
 * it via `page.addInitScript` before `goto` reproduces that script, so both
 * scans below see the real pre-paint theme.
 */

/**
 * Press Tab repeatedly (bounded) until `target` actually receives DOM focus,
 * or throw. Proves an element is reachable via the browser's own sequential
 * keyboard navigation, not merely that `locator.focus()` can force focus onto
 * it. Bounded so a regression that removes the target from the tab order
 * fails fast instead of hanging.
 */
async function tabUntilFocused(page: Page, target: Locator, maxPresses: number): Promise<void> {
  for (let i = 0; i < maxPresses; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) {
      return;
    }
  }
  throw new Error(`Tab did not reach the target element within ${maxPresses} presses`);
}

/**
 * Locators for the seeded listing's pin and its mini-card's three stops,
 * scoped by accessible name rather than DOM position (see the module doc).
 * The pin lives outside `map-carousel` (a sibling subtree), so scoping the
 * card/favourite/chevron lookups to the carousel container is enough to keep
 * the exact-name pin match from also matching inside it.
 */
function listingLocators(page: Page, listingName: string) {
  const escaped = listingName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const carousel = page.getByTestId("map-carousel");
  return {
    pin: page.getByRole("button", { name: listingName, exact: true }),
    cardButton: carousel.getByRole("button", { name: new RegExp(`^${escaped}`) }),
    favoriteButton: carousel.getByRole("button", {
      name: new RegExp(`^Save(d, remove)? ${escaped}$`),
    }),
    chevronLink: carousel.getByRole("link", { name: `View ${listingName}`, exact: true }),
  };
}

test.describe("directory map view (?view=map, DB-gated)", () => {
  let seeder: Seeder;
  let listingName: string;

  test.beforeEach(async () => {
    test.skip(!E2E_DB_READY, "needs CI E2E DATABASE_URL + SESSION_SECRET");
    seeder = new Seeder();
    const token = uniqueToken("map-a11y");
    const listing = await seeder.createListing(token, { name: `0000-${token} Diner` });
    listingName = listing.name;
  });

  test.afterEach(async () => {
    await seeder?.cleanup();
  });

  const MAP_THEMES = ["light", "dark"] as const;

  for (const theme of MAP_THEMES) {
    test(`a11y: ?view=map has no WCAG 2 A/AA violations (${theme} theme)`, async ({ page }) => {
      if (theme === "dark") {
        await page.addInitScript(() => localStorage.setItem("theme", "dark"));
      }
      await page.goto("/?view=map&sort=alpha");
      await waitForBrowseReady(page);
      // The pin/carousel render only once the map content area mounts and the
      // seeded listing lands — wait for the pin so axe scans the real pin +
      // carousel DOM, not a still-loading content area.
      await expect(listingLocators(page, listingName).pin).toBeVisible();

      const { violations, summary } = await runAxeScan(page);
      if (violations.length > 0) {
        console.error(
          `axe violations on /?view=map (${theme} theme):\n${JSON.stringify(summary, null, 2)}`
        );
      }
      expect(
        violations,
        `axe found ${violations.length} WCAG 2 A/AA violation(s) on /?view=map (${theme} theme) — see console output above`
      ).toEqual([]);
    });
  }

  /**
   * Live-path keyboard operability: a pin must be reachable by Tab, not just
   * clickable; Enter must select it (`aria-pressed`, never colour alone);
   * that selection must sync to the matching mini-card in the carousel; and
   * tab order must then proceed through the selected mini-card's three
   * stops in order — the card button, the favourite button, then the
   * chevron link — never nested (`MapCarousel`'s doc in `map-ui.tsx`).
   */
  test("keyboard: Tab reaches a pin button, Enter selects it, and the carousel stays in sync", async ({
    page,
  }) => {
    await page.goto("/?view=map&sort=alpha");
    await waitForBrowseReady(page);

    const { pin, cardButton, favoriteButton, chevronLink } = listingLocators(page, listingName);
    await expect(pin).toBeVisible();

    // Tab from a blank focus (nothing is focused on a fresh load) until the
    // seeded pin actually receives focus. Bounded generously: the
    // directory's header + filter chrome (search, quick/taxonomy chips,
    // sort, distance, ViewToggle, …) all precede the map content area, and
    // `?sort=alpha` puts the seeded listing at entries[0] — the first pin in
    // DOM order — ahead of any other pin.
    await tabUntilFocused(page, pin, 80);
    await expect(pin).toBeFocused();

    // Enter activates the pin like any real <button>.
    await page.keyboard.press("Enter");
    await expect(pin).toHaveAttribute("aria-pressed", "true");

    // Carousel sync: activating a pin must select its matching mini-card too
    // (the shared `useUserSelectionChange` discriminator in `map-ui.tsx`).
    await expect(cardButton).toHaveAttribute("aria-pressed", "true");

    // Continue the same tab sequence (focus is still on the pin — a keypress
    // doesn't move it) through to the mini-card's three stops, confirming
    // both the order and that each is individually reachable.
    await tabUntilFocused(page, cardButton, 60);
    await expect(cardButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(favoriteButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(chevronLink).toBeFocused();
  });

  /**
   * The pin is a real <button>, so Space must activate it exactly like Enter
   * does above. Scoped narrowly — a direct `.focus()`, not a re-walk of the
   * full tab order already proven above — since the only thing left to
   * prove is that the other native activation key fires the same handler.
   */
  test("keyboard: Space also activates the pin button", async ({ page }) => {
    await page.goto("/?view=map&sort=alpha");
    await waitForBrowseReady(page);

    const { pin } = listingLocators(page, listingName);
    await expect(pin).toBeVisible();
    await pin.focus();
    await page.keyboard.press("Space");
    await expect(pin).toHaveAttribute("aria-pressed", "true");
  });
});
