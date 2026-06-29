import { expect, test } from "@playwright/test";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";
import { waitForHydration } from "./helpers";

/**
 * Report an incident (issue #45).
 *
 * Seed a listing (no incidents), sign in, then submit a "got glutened" report
 * dated today via the login-gated incident form. The write is a real
 * `submitIncident` (ADR-007). We assert it appears in the incident list AND that
 * a recent report flags the summary: the prominent "Recent incident warning"
 * banner renders near the top of the page (recent harm is never buried beneath
 * older confirmations).
 *
 * `occurredOn` is set to today (UTC) so it is in the 90-day recency window AND
 * never in the future (the schema rejects future dates). Self-skips without the
 * CI E2E DB / session secret (see fixtures.ts).
 */
test.describe("report an incident", () => {
  let seeder: Seeder;
  let listingId: string;

  test.beforeEach(async ({ context, baseURL }) => {
    test.skip(!E2E_DB_READY, "needs CI E2E DATABASE_URL + SESSION_SECRET");
    seeder = new Seeder();

    const listing = await seeder.createListing(uniqueToken("incident"));
    listingId = listing.id;

    const user = await seeder.createUser(uniqueToken("reporter"));
    // biome-ignore lint/style/noNonNullAssertion: Playwright always provides baseURL from the config.
    await seeder.signIn(context, user.id, baseURL!);
  });

  test.afterEach(async () => {
    await seeder?.cleanup();
  });

  test("submitting a got-glutened report flags the summary", async ({ page }) => {
    await page.goto(`/listings/${listingId}`);
    await waitForHydration(page);

    // Before reporting: the honest empty state, no recent-incident banner.
    await expect(page.getByText("No “got glutened here” reports yet.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Recent incident warning" })).toHaveCount(0);

    // Today's UTC calendar date — in-window and never in the future.
    const today = new Date().toISOString().slice(0, 10);

    const form = page.getByRole("form", { name: "Report an incident" });
    await form.getByLabel(/Date it happened/).fill(today);
    await form.getByLabel("Severity (optional)").selectOption("moderate");
    await form.getByLabel("What happened (optional)").fill("Cross-contamination reaction.");
    await form.getByRole("button", { name: "Submit report" }).click();

    // The report now appears in the list (the empty state is gone)…
    await expect(page.getByText("No “got glutened here” reports yet.")).toHaveCount(0);
    await expect(page.getByText("Cross-contamination reaction.")).toBeVisible();
    // …and a recent report flags the summary with the prominent warning banner.
    await expect(page.getByRole("region", { name: "Recent incident warning" })).toBeVisible();
  });
});
