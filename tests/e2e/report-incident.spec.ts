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
 * The banner is `RecentIncidentBanner`. It is derived CLIENT-SIDE: `ListingDetail`
 * in `listings.$id.tsx` reads `incidents` via `useSuspenseQuery` and computes
 * `recentIncident = findRecentIncident(incidents, now)` from that SAME query that
 * renders the incident note. When the report form invalidates the incidents
 * query after submit, the component re-renders and the banner appears LIVE — no
 * reload needed. We assert the banner's distinctive USER-VISIBLE warning text
 * (with a generous timeout to absorb the post-invalidation refetch), which is
 * what genuinely proves "a recent report flags the summary". The banner's
 * accessibility (its `role="region"` + `aria-label="Recent incident warning"`)
 * is already guarded by `RecentIncidentBanner.test.tsx`, so the E2E need not
 * re-assert the role — and the section's accessible-name resolves differently in
 * the live full-page DOM than in jsdom, so the visible-text assertion is also
 * the robust one here.
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

    // The banner's distinctive user-visible warning text — the real signal a
    // diner sees. (Its role/aria-label is covered by RecentIncidentBanner.test.tsx.)
    const bannerText = page.getByText(/A diner reported getting glutened here on/);

    // Before reporting: the honest empty state, no recent-incident banner.
    await expect(page.getByText("No “got glutened here” reports yet.")).toBeVisible();
    await expect(bannerText).toHaveCount(0);

    // Yesterday's UTC calendar date — unambiguously in-window and strictly past.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // The report form lives in a modal — open it via its trigger button first.
    await page.getByRole("button", { name: "Report an incident" }).click();

    const form = page.getByRole("form", { name: "Report an incident" });
    await form.getByLabel(/Date it happened/).fill(yesterday);
    await form.getByLabel("Severity (optional)").selectOption("moderate");
    await form.getByLabel("What happened (optional)").fill("Cross-contamination reaction.");
    await form.getByRole("button", { name: "Submit report" }).click();

    // The report appears in the list (the empty state is gone). The form
    // invalidates the incidents query, so the list reflects the write.
    await expect(page.getByText("No “got glutened here” reports yet.")).toHaveCount(0);
    await expect(page.getByText("Cross-contamination reaction.")).toBeVisible();

    // The same invalidated query drives the recent-incident banner, so its
    // warning appears LIVE (no reload). Generous timeout to absorb the refetch.
    // This proves "a recent report flags the summary" via the user-facing text.
    await expect(bannerText).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Recent incident ·/)).toBeVisible();
  });
});
