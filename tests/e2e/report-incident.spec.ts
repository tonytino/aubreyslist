import { expect, test } from "@playwright/test";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";
import { waitForHydration } from "./helpers";

/**
 * Report an incident (issue #45).
 *
 * Seed a listing (no incidents), sign in, then submit a "got glutened" report
 * via the login-gated incident form. The write is a real `submitIncident`
 * (ADR-007). We assert it appears in the incident list AND that a recent report
 * flags the summary: the prominent recent-incident banner renders near the top
 * of the page (recent harm is never buried beneath older confirmations).
 *
 * The banner is `RecentIncidentBanner` — a `<section aria-label="Recent incident
 * warning">` (role `region`) whose presence is derived by the route loader from
 * the listing's incidents against a `now` it resolves ONCE, server-side, at load
 * (`listings.$id.tsx`). We therefore RELOAD after submitting so the loader
 * re-derives the banner from a fresh server read with a server-consistent `now`,
 * rather than depending on the client query's post-submit invalidation timing —
 * which is exactly how this trust-critical signal surfaces in production (it is
 * server-rendered on load, deliberately a `region`, not a live `alert`).
 *
 * `occurredOn` is dated YESTERDAY (UTC) so it is unambiguously inside the 90-day
 * recency window AND strictly in the past — the schema rejects future dates, and
 * a yesterday date can never be read as "future" even if the server/runner clock
 * straddles a UTC-midnight boundary relative to the browser. Self-skips without
 * the CI E2E DB / session secret (see fixtures.ts).
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

    const banner = page.getByRole("region", { name: "Recent incident warning" });

    // Before reporting: the honest empty state, no recent-incident banner.
    await expect(page.getByText("No “got glutened here” reports yet.")).toBeVisible();
    await expect(banner).toHaveCount(0);

    // Yesterday's UTC calendar date — unambiguously in-window and strictly past.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const form = page.getByRole("form", { name: "Report an incident" });
    await form.getByLabel(/Date it happened/).fill(yesterday);
    await form.getByLabel("Severity (optional)").selectOption("moderate");
    await form.getByLabel("What happened (optional)").fill("Cross-contamination reaction.");
    await form.getByRole("button", { name: "Submit report" }).click();

    // The report appears in the list (the empty state is gone). The form
    // invalidates the incidents query, so the list reflects the write.
    await expect(page.getByText("No “got glutened here” reports yet.")).toHaveCount(0);
    await expect(page.getByText("Cross-contamination reaction.")).toBeVisible();

    // Reload so the loader re-derives the banner server-side from a fresh read
    // (its `now` is resolved once on the server at load) — the production path
    // for this trust-critical signal. The report must now flag the summary.
    await page.reload();
    await waitForHydration(page);
    await expect(page.getByText("Cross-contamination reaction.")).toBeVisible();
    await expect(banner).toBeVisible();
  });
});
