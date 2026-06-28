import { expect, test } from "@playwright/test";

import { waitForBrowseReady } from "./helpers";

/**
 * "Near me" distance sort (#37). Choosing the distance sort requests browser
 * geolocation; on grant the view sorts by distance and the URL carries the
 * coords, on denial it falls back gracefully to alphabetical with an accessible
 * message. We use Playwright's geolocation mocking (context permissions +
 * coordinates) for the grant path and an injected error callback for the deny
 * path — no real permission prompt.
 *
 * Every interaction waits for {@link waitForBrowseReady} first: until hydration
 * AND the route's initial search-param canonicalization settle, the <select>'s
 * onChange isn't wired and a selection gets clobbered (the flake the earlier
 * browse specs hit). See helpers.ts.
 */

const DENVER = { latitude: 39.7392, longitude: -104.9903 };

test.describe("near me — geolocation granted", () => {
  test.use({ geolocation: DENVER, permissions: ["geolocation"] });

  test("sorting by distance with permission granted puts coords in the URL", async ({ page }) => {
    await page.goto("/listings");

    const sort = page.getByLabel("Sort by");
    await expect(sort).toBeVisible();
    await waitForBrowseReady(page);

    await sort.selectOption("distance");

    // On grant the route navigates to sort=distance with the user's coords.
    await expect(page).toHaveURL(/sort=distance/);
    await expect(page).toHaveURL(/lat=39\.7392/);
    await expect(page).toHaveURL(/lng=-104\.9903/);

    // The list (or honest empty state) still renders — distance sort never crashes.
    const resultsList = page.getByRole("list");
    const emptyState = page.getByRole("heading", { name: "No listings yet" });
    await expect(resultsList.or(emptyState).first()).toBeVisible();
  });
});

test.describe("near me — geolocation denied", () => {
  // No `permissions: ["geolocation"]`. We also force the error callback so the
  // deny path is deterministic regardless of the headless default.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const denied = {
        code: 1, // PERMISSION_DENIED
        message: "User denied Geolocation",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      };
      navigator.geolocation.getCurrentPosition = (_success, error) => {
        if (error) {
          error(denied as GeolocationPositionError);
        }
      };
    });
  });

  test("denied geolocation falls back to alphabetical with an accessible message", async ({
    page,
  }) => {
    await page.goto("/listings");

    const sort = page.getByLabel("Sort by");
    await expect(sort).toBeVisible();
    await waitForBrowseReady(page);

    await sort.selectOption("distance");

    // Graceful fallback: the URL reverts to the alphabetical default (no coords),
    // and an accessible alert explains why — never a crash or hang.
    await expect(page).toHaveURL(/sort=alpha/);
    await expect(page).not.toHaveURL(/lat=/);
    await expect(page.getByRole("alert")).toContainText(/denied/i);

    // The list still renders under the fallback order.
    const resultsList = page.getByRole("list");
    const emptyState = page.getByRole("heading", { name: "No listings yet" });
    await expect(resultsList.or(emptyState).first()).toBeVisible();
  });
});
