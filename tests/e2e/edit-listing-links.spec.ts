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

    // Barriers before asserting the UI (see the legacy-removal test for the
    // full rationale): the dialog closes only in the mutation's onSuccess, and
    // the DB poll confirms the write landed — the save's client-side refresh
    // can otherwise be lost to a mid-save document reload (AUB-223). NOTE:
    // deliberately no `page.reload()` here — issuing our own navigation can
    // collide with that in-flight framework reload and destabilise the
    // interactions below; the presence assertions retry until whichever refresh
    // wins renders the committed row.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => seeder.getListingLinkUrl(listing.id, "website")).toBe(url);

    // The new typed link renders as a button.
    const websiteLink = linksSection.getByRole("link", { name: "Website", exact: true });
    await expect(websiteLink).toBeVisible();
    await expect(websiteLink).toHaveAttribute("href", url);

    // The affordance now reads "Edit links" and re-opens pre-filled.
    await linksSection.getByRole("button", { name: "Edit links" }).click();
    await expect(page.getByLabel("Website", { exact: true })).toHaveValue(url);
  });

  test("removing a legacy menu link sticks (no fallback resurrection)", async ({
    context,
    page,
    baseURL,
  }) => {
    // A pre-AUB-202 row: menu link only in the legacy menu_url column. Clearing
    // the pre-filled menu field must remove the button FOR GOOD — the server
    // clears the legacy column too, so the render fallback cannot resurrect it
    // after the refetch (adversarial-review finding 1).
    const listing = await seeder.createListing(uniqueToken("LegacySpot"), {
      menuUrl: "https://legacy.example/menu",
    });
    const user = await seeder.createUser(uniqueToken("legacy-editor"));
    // biome-ignore lint/style/noNonNullAssertion: Playwright always provides baseURL from the config.
    await seeder.signIn(context, user.id, baseURL!);

    await page.goto(`/listings/${listing.id}`);
    await waitForHydration(page);

    // The legacy fallback renders the menu button, so the affordance reads Edit.
    const linksSection = page.getByRole("region", { name: "Links" });
    await expect(linksSection.getByRole("link", { name: "Menu", exact: true })).toBeVisible();
    await linksSection.getByRole("button", { name: "Edit links" }).click();

    // Pre-filled with the legacy value; clear it and save.
    const menuField = page.getByLabel("Menu", { exact: true });
    await expect(menuField).toHaveValue("https://legacy.example/menu");
    await menuField.fill("");
    await page.getByRole("button", { name: "Save links" }).click();

    // Two barriers, reconciling #293 and AUB-222 — both are needed:
    //
    // 1. Dialog-close (from #293): the dialog closes only in the mutation's
    //    onSuccess, i.e. after the server deleted the typed row AND cleared the
    //    legacy menu_url column. While it is open the modal marks the
    //    background aria-hidden, so the Links assertion below would pass
    //    vacuously. This gates on client-observable success.
    //
    // 2. DB-side barrier (AUB-222): a framework-initiated mid-save document
    //    reload (AUB-223) can both discard the client-side refetch AND
    //    server-render the page from a read that raced the still-committing
    //    mutation — so even after the dialog closes, the following `page.reload`
    //    can SSR a stale row and resurrect the legacy Menu link (red at CI's
    //    Neon latency). Poll the column this spec guards — the write contract —
    //    until it is actually null before reloading, closing the race window.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => seeder.getListingMenuUrl(listing.id)).toBeNull();

    // With the write confirmed landed, the pre-reload UI must already reflect
    // the removal (the dialog-close refetch has run) — a non-vacuous DOM check
    // that no longer races the mutation now that the barriers are in front.
    await expect(linksSection.getByRole("link", { name: "Menu", exact: true })).toHaveCount(0);

    // And it STAYS gone across a full reload — the legacy column was cleared
    // server-side, not just hidden client-side, so the render fallback cannot
    // resurrect it even from a fresh SSR.
    await page.reload();
    await waitForHydration(page);
    await expect(
      page.getByRole("region", { name: "Links" }).getByRole("link", { name: "Menu", exact: true })
    ).toHaveCount(0);
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
