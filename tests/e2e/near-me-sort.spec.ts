import { expect, test } from "@playwright/test";

import { waitForBrowseReady } from "./helpers";

/**
 * The "near me" distance sort, which is the directory's default order.
 *
 * Three contracts, in order of importance:
 *
 *  1. The visitor's coordinates NEVER reach the URL. They are route state for
 *     the life of the tab, so history, referrers and shared links stay clean.
 *  2. A bare visit sorts by distance when the browser grants location, and
 *     asks for it when the browser has not answered.
 *  3. With no location at all the page degrades to the recently-confirmed
 *     order and says so, rather than pretending to sort by distance.
 *
 * Playwright's geolocation mocking (context permissions + coordinates) drives
 * the granted path; an injected error callback drives the refused one, so
 * neither depends on a real permission prompt. Every interaction waits for
 * {@link waitForBrowseReady}: until hydration settles the `<select>`'s
 * onChange isn't wired and a selection gets clobbered. See helpers.ts.
 */

const DENVER = { latitude: 39.7392, longitude: -104.9903 };

test.describe("near me — geolocation granted", () => {
  test.use({ geolocation: DENVER, permissions: ["geolocation"] });

  test("a bare visit sorts by distance and keeps coordinates out of the URL", async ({ page }) => {
    await page.goto("/");
    await waitForBrowseReady(page);

    // "Near me" is the default, so it is selected with no interaction and
    // `?sort=` stays stripped from a clean URL.
    await expect(page.getByLabel("Sort by")).toHaveValue("distance");
    await expect(page).toHaveURL(/^[^?]*\/$/);

    // The reading reached the server as a server-function argument only.
    await expect(page).not.toHaveURL(/lat=|lng=|39\.7|104\.9/);

    const resultsList = page.getByRole("list");
    const emptyState = page.getByRole("heading", {
      name: /Let's find your safe table|No spots match/,
    });
    await expect(resultsList.or(emptyState).first()).toBeVisible();
  });

  test("switching away and back never puts coordinates in the URL", async ({ page }) => {
    await page.goto("/");
    await waitForBrowseReady(page);

    const sort = page.getByLabel("Sort by");
    await sort.selectOption("trust");
    await expect(page).toHaveURL(/sort=trust/);

    await sort.selectOption("distance");
    // Back to the default: `?sort=` strips, and still no coordinates.
    await expect(page).not.toHaveURL(/sort=/);
    await expect(page).not.toHaveURL(/lat=|lng=/);
  });

  test("a distance-sorted view shares as a bare link", async ({ page, context }) => {
    await page.goto("/");
    await waitForBrowseReady(page);
    const shared = page.url();
    expect(shared).not.toMatch(/lat=|lng=/);

    // The recipient loads the same link and is anchored by their own browser,
    // not by the sender's coordinates.
    const recipient = await context.newPage();
    await recipient.goto(shared);
    await waitForBrowseReady(recipient);
    await expect(recipient.getByLabel("Sort by")).toHaveValue("distance");
    await recipient.close();
  });
});

test.describe("near me — geolocation refused", () => {
  // No `permissions: ["geolocation"]`. The error callback is forced so the
  // refusal is deterministic regardless of the headless default.
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

  test("a refused reading keeps the selection and explains the fallback order", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForBrowseReady(page);

    // The control stays where the default put it — the page does not silently
    // swap the visitor's sort — and an accessible alert names what it is
    // showing instead. Local runs have no coarse request anchor either, so
    // this is the no-location-at-all path.
    await expect(page.getByLabel("Sort by")).toHaveValue("distance");
    await expect(page.getByRole("alert")).toContainText(/recently confirmed/i);

    // Still no coordinates anywhere in the URL, and still a rendered page.
    await expect(page).not.toHaveURL(/lat=|lng=/);
    const resultsList = page.getByRole("list");
    const emptyState = page.getByRole("heading", {
      name: /Let's find your safe table|No spots match/,
    });
    await expect(resultsList.or(emptyState).first()).toBeVisible();
  });

  test("choosing another sort clears the location alert", async ({ page }) => {
    await page.goto("/");
    await waitForBrowseReady(page);
    await expect(page.getByRole("alert")).toBeVisible();

    await page.getByLabel("Sort by").selectOption("alpha");
    await expect(page).toHaveURL(/sort=alpha/);
    // A sort that needs no location has nothing to explain.
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});
