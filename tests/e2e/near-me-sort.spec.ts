import { expect, test } from "@playwright/test";

import { waitForBrowseReady } from "./helpers";

/**
 * "Near me" distance sort. Choosing the distance sort requests browser
 * geolocation; on grant the view sorts by distance and the URL carries the
 * coords, on denial it falls back gracefully to alphabetical with an
 * accessible message. We use Playwright's geolocation mocking (context
 * permissions + coordinates) for the grant path and an injected error callback
 * for the deny path — no real permission prompt.
 *
 * The sort control is the labelled select chip directly in the filter row, so
 * there is no sheet to open or close; the results content is always visible
 * below the sticky filter bar.
 *
 * Every interaction waits for {@link waitForBrowseReady} first: until
 * hydration settles, the <select>'s onChange isn't wired and a selection gets
 * clobbered. See helpers.ts.
 */

const DENVER = { latitude: 39.7392, longitude: -104.9903 };

test.describe("near me — geolocation granted", () => {
  test.use({ geolocation: DENVER, permissions: ["geolocation"] });

  test("sorting by distance with permission granted puts coords in the URL", async ({ page }) => {
    await page.goto("/");
    await waitForBrowseReady(page);

    const sort = page.getByLabel("Sort by");
    await expect(sort).toBeVisible();

    await sort.selectOption("distance");

    // On grant the route navigates to sort=distance with the user's coords.
    await expect(page).toHaveURL(/sort=distance/);
    await expect(page).toHaveURL(/lat=39\.7392/);
    await expect(page).toHaveURL(/lng=-104\.9903/);

    // Confirm the results content actually renders under the distance sort —
    // either a results list or an honest empty/no-results heading. Distance sort
    // never crashes.
    const resultsList = page.getByRole("list");
    const emptyState = page.getByRole("heading", {
      name: /Let's find your safe table|No spots match/,
    });
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
    await page.goto("/");
    await waitForBrowseReady(page);

    const sort = page.getByLabel("Sort by");
    await expect(sort).toBeVisible();

    await sort.selectOption("distance");

    // Graceful fallback: the sort reverts to the alphabetical default — which
    // stripSearchParams drops from the URL — so `sort` disappears entirely (no
    // `sort=distance`, no coords), and an accessible alert rendered under the
    // chip row explains why. Never a crash or hang.
    await expect(page).not.toHaveURL(/sort=/);
    await expect(page).not.toHaveURL(/lat=/);
    await expect(page.getByRole("alert")).toContainText(/denied/i);

    // Confirm the results content renders under the fallback order — a results
    // list or an honest empty/no-results heading.
    const resultsList = page.getByRole("list");
    const emptyState = page.getByRole("heading", {
      name: /Let's find your safe table|No spots match/,
    });
    await expect(resultsList.or(emptyState).first()).toBeVisible();
  });
});

test.describe("near me — remembered opt-in", () => {
  test.use({ geolocation: DENVER, permissions: ["geolocation"] });

  test("a granted device restores the distance sort on a bare visit", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("near-me-sort", "true");
    });

    await page.goto("/");
    await waitForBrowseReady(page);

    // The restore runs off the stored flag plus an existing grant, so a bare
    // `/` lands on the distance sort with coords, with no interaction.
    await expect(page).toHaveURL(/sort=distance/);
    await expect(page).toHaveURL(/lat=39\.7392/);
    await expect(page.getByLabel("Sort by")).toHaveValue("distance");
  });

  test("an explicit sort in the URL wins over the remembered opt-in", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("near-me-sort", "true");
    });

    await page.goto("/?sort=trust");
    await waitForBrowseReady(page);

    await expect(page).toHaveURL(/sort=trust/);
    await expect(page).not.toHaveURL(/sort=distance/);
  });

  test("choosing another sort forgets the opt-in", async ({ page }) => {
    // Seeded through the page, not `addInitScript`: an init script re-runs on
    // every navigation and would rewrite the flag this test needs cleared.
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("near-me-sort", "true");
    });
    await page.reload();
    await waitForBrowseReady(page);
    await expect(page).toHaveURL(/sort=distance/);

    await page.getByLabel("Sort by").selectOption("trust");
    await expect(page).toHaveURL(/sort=trust/);
    expect(await page.evaluate(() => localStorage.getItem("near-me-sort"))).toBeNull();

    await page.goto("/");
    await waitForBrowseReady(page);
    await expect(page.getByLabel("Sort by")).toHaveValue("alpha");
    await expect(page).not.toHaveURL(/sort=distance/);
  });
});

test.describe("near me — remembered opt-in without a grant", () => {
  // No `permissions: ["geolocation"]`: the stored flag alone must never open a
  // permission prompt or hijack the default order.
  test("a stored opt-in is ignored until the browser grants location", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("near-me-sort", "true");
    });

    await page.goto("/");
    await waitForBrowseReady(page);
    // Settle on rendered results before the negative assertions, so "no
    // restore happened" isn't just "the restore hadn't run yet".
    const resultsList = page.getByRole("list");
    const emptyState = page.getByRole("heading", {
      name: /Let's find your safe table|No spots match/,
    });
    await expect(resultsList.or(emptyState).first()).toBeVisible();

    await expect(page).not.toHaveURL(/sort=distance/);
    await expect(page.getByLabel("Sort by")).toHaveValue("alpha");
    // The flag survives: an ungranted browser is not a denial to forget.
    expect(await page.evaluate(() => localStorage.getItem("near-me-sort"))).toBe("true");
  });
});
