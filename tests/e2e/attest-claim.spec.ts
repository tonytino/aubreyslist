import { expect, test } from "@playwright/test";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";
import { waitForHydration } from "./helpers";

/**
 * Attest a claim (issue #45).
 *
 * Seed a listing with a `celiac_safe_vs_gluten_friendly` claim that has NO
 * attestation evidence yet (so the headline cue reads the honest "Not yet
 * attested"), sign in, then CONFIRM the claim. The vote is a real
 * `submitVote` write (ADR-007). We assert the transparent trust summary updates:
 * the per-claim roll-up shows "1 confirm / 0 dispute", the Confirm control
 * reflects the viewer's own vote (`aria-pressed`), and the headline summary flips
 * to "Celiac-safe" (fresh confirm-majority → `deriveHeadlineSafetyState`).
 *
 * Self-skips without the CI E2E DB / session secret (see fixtures.ts).
 */
test.describe("attest a claim (confirm)", () => {
  let seeder: Seeder;
  let listingId: string;

  test.beforeEach(async ({ context, baseURL }) => {
    test.skip(!E2E_DB_READY, "needs CI E2E DATABASE_URL + SESSION_SECRET");
    seeder = new Seeder();

    const listing = await seeder.createListing(uniqueToken("attest"));
    listingId = listing.id;
    // A claim with zero attestations: the headline starts at "Not yet attested".
    await seeder.createClaim(listing.id, "celiac_safe_vs_gluten_friendly");

    const user = await seeder.createUser(uniqueToken("attester"));
    // biome-ignore lint/style/noNonNullAssertion: Playwright always provides baseURL from the config.
    await seeder.signIn(context, user.id, baseURL!);
  });

  test.afterEach(async () => {
    await seeder?.cleanup();
  });

  test("confirming a claim updates the trust summary", async ({ page }) => {
    await page.goto(`/listings/${listingId}`);
    await waitForHydration(page);

    // Before voting: the headline cue is the honest empty state.
    const safety = page.getByRole("region", { name: "Gluten-free safety" });
    await expect(safety.getByText("Not yet attested")).toBeVisible();

    // Confirm the headline claim. The control is rendered for a signed-in viewer.
    const confirm = page.getByRole("button", { name: "Confirm" });
    await expect(confirm).toBeVisible();
    await confirm.click();

    // The viewer's own vote is now reflected on the control…
    await expect(confirm).toHaveAttribute("aria-pressed", "true");
    // …the per-claim roll-up shows the visible confirm/dispute distribution…
    await expect(page.getByText("1 confirm / 0 dispute")).toBeVisible();
    // …and the headline summary flips to celiac-safe (fresh confirm-majority).
    await expect(safety.getByText("Celiac-safe")).toBeVisible();
  });
});
