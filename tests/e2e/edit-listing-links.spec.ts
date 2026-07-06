import { expect, test } from "@playwright/test";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";
import { waitForHydration } from "./helpers";

/**
 * Post-creation link editing on the listing detail page (AUB-202).
 *
 * Listing links are WIKI-STYLE: any signed-in user may add/edit them (the
 * server re-gates writes regardless). This spec seeds a listing + a user via
 * the shared fixtures, signs the user in with a sealed session cookie, opens
 * the detail page's "Add links" dialog, saves a website link, and asserts the
 * new button renders. Cleanup: `Seeder.cleanup()` deletes the seeded listing,
 * which cascades to the `listing_links` row the APP wrote.
 *
 * Anonymous viewers must NOT see the edit affordance — covered here against
 * a fresh context. Self-skips without the CI E2E DB / session secret.
 */
test.describe("edit listing links (wiki-style, signed-in)", () => {
  let seeder: Seeder;

  test.beforeEach(() => {
    test.skip(!E2E_DB_READY, "needs CI E2E DATABASE_URL + SESSION_SECRET");
    seeder = new Seeder();
  });

  test.afterEach(async () => {
    // Deleting the seeded listing cascades to any listing_links rows the app
    // inserted during the test, so the persistent CI branch stays tidy.
    await seeder?.cleanup();
  });

  test("signed-in user adds a website link from the detail page", async ({
    context,
    page,
    baseURL,
  }) => {
    const listing = await seeder.createListing(uniqueToken("LinksSpot"));
    const user = await seeder.createUser(uniqueToken("link-editor"));
    // biome-ignore lint/style/noNonNullAssertion: Playwright always provides baseURL from the config.
    await seeder.signIn(context, user.id, baseURL!);

    await page.goto(`/listings/${listing.id}`);
    await waitForHydration(page);

    // No links yet — the affordance reads "Add links".
    const linksSection = page.getByRole("region", { name: "Links" });
    await linksSection.getByRole("button", { name: "Add links" }).click();

    // Fill one kind and save. Labels are exact: "Menu" vs "Gluten-free menu".
    const url = `https://links.example/${user.id}`;
    await page.getByLabel("Website", { exact: true }).fill(url);
    await page.getByRole("button", { name: "Save links" }).click();

    // The dialog closes and the new typed link renders as a button.
    const websiteLink = linksSection.getByRole("link", { name: "Website", exact: true });
    await expect(websiteLink).toBeVisible();
    await expect(websiteLink).toHaveAttribute("href", url);

    // The affordance now reads "Edit links" and re-opens pre-filled.
    await linksSection.getByRole("button", { name: "Edit links" }).click();
    await expect(page.getByLabel("Website", { exact: true })).toHaveValue(url);
  });

  test("anonymous viewers see links but no edit affordance", async ({ page }) => {
    const listing = await seeder.createListing(uniqueToken("AnonLinksSpot"), {
      menuUrl: "https://legacy.example/menu",
    });

    await page.goto(`/listings/${listing.id}`);
    await waitForHydration(page);

    // The legacy menuUrl renders as the menu link (fallback), but with no
    // session there is no Add/Edit links button — writes are login-gated.
    const linksSection = page.getByRole("region", { name: "Links" });
    await expect(linksSection.getByRole("link", { name: "Menu", exact: true })).toBeVisible();
    await expect(linksSection.getByRole("button", { name: /links/i })).toHaveCount(0);
  });
});
