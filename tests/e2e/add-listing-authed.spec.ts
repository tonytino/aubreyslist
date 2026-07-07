import { expect, test } from "@playwright/test";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";
import { waitForHydration } from "./helpers";

/**
 * Add a listing as a signed-in user (issue #45, wizard rework AUB-132).
 *
 * The existing `add-listing.spec.ts` covers the ANONYMOUS gate (sign-in prompt).
 * This spec covers the authenticated happy path end-to-end through the 7-step
 * claim wizard: with intake forced to `manual` (the deterministic, Places-key-
 * free mode — default is `places`, ADR-008) and a sealed session cookie, find
 * the place manually, add typed links (menu + website, AUB-202), skip every
 * claim (skip writes nothing; the create still succeeds), submit, then follow
 * the success screen's "View your listing" and assert it lands on the new
 * listing's detail page showing the entered name and the typed link buttons.
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
    // Hydration must finish before interacting: the manual finder's onChange
    // handlers and the `disabled` gate on "Use this place" aren't wired until the
    // client bundle runs (see waitForHydration). We additionally gate on the
    // button being ENABLED below — proof every field's onChange registered —
    // before clicking, so we never fire a no-op click into a not-yet-interactive
    // form and never rely on a retry.
    await waitForHydration(page);

    await expect(page.getByRole("heading", { name: "Add a restaurant" })).toBeVisible();

    // Step 0 — find the place via the manual finder, then collect it.
    await page.getByLabel("Restaurant name").fill(name);
    await page.getByLabel("Address").fill("42 Gluten-Free Ave, Denver, CO");
    await page.getByLabel("Latitude").fill("39.7392");
    await page.getByLabel("Longitude").fill("-104.9903");

    const useThisPlace = page.getByRole("button", { name: "Use this place" });
    await expect(useThisPlace).toBeEnabled();
    await useThisPlace.click();

    // Selected-place confirmation card: add two typed links (AUB-202) — the
    // other three kinds stay blank and must not be submitted — then Continue
    // into the claim steps. Labels are exact: "Menu" must not match
    // "Gluten-free menu".
    await page.getByLabel("Menu", { exact: true }).fill("https://new-spot.example/menu");
    await page.getByLabel("Website", { exact: true }).fill("https://new-spot.example");
    await page.getByRole("button", { name: "Continue" }).click();

    // Steps 1–5 — skip every attribute. Skip writes nothing (first-class), and
    // the create must still succeed with all five left "Not yet attested".
    for (let index = 0; index < 5; index += 1) {
      await page.getByRole("button", { name: /Skip \(not sure\)/ }).click();
    }

    // Review → submit. We never auto-redirect: the wizard ends on a success
    // screen, from which the contributor chooses to view the new listing.
    await page.getByRole("button", { name: "Submit listing" }).click();
    await expect(page.getByRole("heading", { name: "Listing added, thanks!" })).toBeVisible();
    await page.getByRole("link", { name: "View your listing" }).click();

    // Lands on the listing-detail page for the new row (a real id, not back on
    // /listings/new), and the detail page shows what we entered — the unique name
    // proves it routed to OUR newly-created listing.
    await expect(page).not.toHaveURL(/\/listings\/new$/);
    await expect(page).toHaveURL(/\/listings\/[^/]+$/);
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    await expect(page.getByText("42 Gluten-Free Ave, Denver, CO")).toBeVisible();

    // The typed links captured at intake render as buttons in the Links
    // section, in LINK_KINDS order (AUB-202); the blank kinds render nothing.
    const linksSection = page.getByRole("region", { name: "Links" });
    const menuLink = linksSection.getByRole("link", { name: "Menu", exact: true });
    await expect(menuLink).toBeVisible();
    await expect(menuLink).toHaveAttribute("href", "https://new-spot.example/menu");
    const websiteLink = linksSection.getByRole("link", { name: "Website", exact: true });
    await expect(websiteLink).toBeVisible();
    await expect(websiteLink).toHaveAttribute("href", "https://new-spot.example");
    await expect(linksSection.getByRole("link", { name: "Reservations", exact: true })).toHaveCount(
      0
    );
  });
});
