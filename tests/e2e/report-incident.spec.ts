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
 * warning">` (role `region`). It is derived CLIENT-SIDE: `ListingDetail` in
 * `listings.$id.tsx` reads `incidents` via `useSuspenseQuery` and computes
 * `recentIncident = findRecentIncident(incidents, now)` from that SAME query that
 * renders the incident note. When the report form invalidates the incidents
 * query after submit, the component re-renders and the banner appears LIVE — no
 * reload needed. We assert it directly with a generous timeout to absorb the
 * post-invalidation refetch.
 *
 * (The data-layer guarantee that `occurredOn` round-trips as a `YYYY-MM-DD`
 * string so `findRecentIncident` actually flags it — the real bug behind an
 * earlier failure — is fixed in `app/server/incidents/index.ts` and proven
 * independently by `tests/integration/incident-date-roundtrip.test.ts`.)
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
    const dateInput = form.getByLabel(/Date it happened/);
    // DIAGNOSTIC (#45): confirm the date control is a native date input and that
    // `.fill(yesterday)` set the value we expect (CI-log ground truth).
    const dateInputType = await dateInput.getAttribute("type");
    await dateInput.fill(yesterday);
    const dateInputValue = await dateInput.inputValue();
    console.log("DIAG yesterday (filled):", yesterday);
    console.log("DIAG date input type:", dateInputType);
    console.log("DIAG date input value after fill:", dateInputValue);

    await form.getByLabel("Severity (optional)").selectOption("moderate");
    await form.getByLabel("What happened (optional)").fill("Cross-contamination reaction.");
    await form.getByRole("button", { name: "Submit report" }).click();

    // The report appears in the list (the empty state is gone). The form
    // invalidates the incidents query, so the list reflects the write.
    await expect(page.getByText("No “got glutened here” reports yet.")).toHaveCount(0);
    await expect(page.getByText("Cross-contamination reaction.")).toBeVisible();

    // DIAGNOSTIC (#45): capture the real rendered region tree + the incident's
    // displayed date into the CI job log, right before the failing assertion, so
    // we can distinguish a UI render bug from a wrong-date submission without CI
    // artifact access. These print to stdout; the assertion below is KEPT.
    const sectionLabels = await page
      .locator("section[aria-label]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    console.log("DIAG sections:", JSON.stringify(sectionLabels));
    console.log("DIAG region count:", await page.getByRole("region").count());
    console.log(
      "DIAG banner-text present:",
      await page.getByText("A diner reported getting glutened").count()
    );
    console.log(
      "DIAG article text:",
      (await page.locator("article").first().innerText()).slice(0, 1200)
    );

    // The same invalidated query drives the recent-incident banner, so it
    // appears LIVE (no reload). Generous timeout to absorb the refetch.
    await expect(banner).toBeVisible({ timeout: 10000 });
  });
});
