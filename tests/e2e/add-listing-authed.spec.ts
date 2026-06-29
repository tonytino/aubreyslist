import { expect, test } from "@playwright/test";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";
import { waitForHydration } from "./helpers";

/**
 * Add a listing as a signed-in user (issue #45).
 *
 * The existing `add-listing.spec.ts` covers the ANONYMOUS gate (sign-in prompt).
 * This spec covers the authenticated happy path end-to-end: with intake forced
 * to `manual` (the deterministic, Places-key-free mode — default is `places`,
 * ADR-008) and a sealed session cookie, fill the manual intake form and assert
 * the route navigates to the new listing's detail page showing the entered name.
 *
 * Manual intake is the simplest deterministic mode — `places` would require the
 * Google Places provider. Self-skips without the CI E2E DB / session secret.
 */
test.describe("add a listing (authenticated, manual intake)", () => {
  let seeder: Seeder;
  // The listing the APP inserts (not the seeder), cleaned up by name afterwards.
  let createdName: string | null;

  test.beforeEach(async ({ context, baseURL }) => {
    test.skip(!E2E_DB_READY, "needs CI E2E DATABASE_URL + SESSION_SECRET");
    seeder = new Seeder();
    createdName = null;
    await seeder.setIntakeMode("manual");
    const user = await seeder.createUser(uniqueToken("adder"));
    // biome-ignore lint/style/noNonNullAssertion: Playwright always provides baseURL from the config.
    await seeder.signIn(context, user.id, baseURL!);
  });

  test.afterEach(async () => {
    // The app-created listing isn't auto-tracked by the seeder, so delete it by
    // its unique name; then the seeder tears down the user + intake-mode row.
    if (createdName) {
      await seeder.deleteListingsByName(createdName);
    }
    await seeder?.cleanup();
  });

  test("signed-in user adds a manual listing and lands on its detail page", async ({ page }) => {
    const name = uniqueToken("New Spot");
    createdName = name;

    await page.goto("/listings/new");
    await waitForHydration(page);

    await expect(page.getByRole("heading", { name: "Add a restaurant" })).toBeVisible();

    await page.getByLabel("Restaurant name").fill(name);
    await page.getByLabel("Address").fill("42 Gluten-Free Ave, Denver, CO");
    await page.getByLabel("Latitude").fill("39.7392");
    await page.getByLabel("Longitude").fill("-104.9903");

    await page.getByRole("button", { name: "Add listing" }).click();

    // On success the route navigates to the listing-detail page for the new row.
    await expect(page).toHaveURL(/\/listings\/[^/]+$/);
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    await expect(page.getByText("42 Gluten-Free Ave, Denver, CO")).toBeVisible();
  });
});
