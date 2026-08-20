import { expect, test } from "@playwright/test";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";
import { waitForHydration } from "./helpers";

/**
 * Report an incident.
 *
 * Seed a listing (no incidents), sign in, then submit a "got glutened" report
 * via the login-gated incident form. The write is a real `submitIncident`
 * (ADR-007). We assert it appears in the incident list and that a recent
 * report flags the summary: the prominent recent-incident banner renders near
 * the top of the page (recent harm is never buried beneath older
 * confirmations).
 *
 * The banner is `RecentIncidentBanner`, derived client-side: `ListingDetail`
 * in `listings.$id.tsx` reads `incidents` via `useSuspenseQuery` and computes
 * `recentIncident = findRecentIncident(incidents, now)` from the same query
 * that renders the incident note. When the report form invalidates the
 * incidents query after submit, the component re-renders and the banner
 * appears live — no reload needed. We assert the banner's distinctive
 * user-visible warning text (with a generous timeout to absorb the
 * post-invalidation refetch), which is what genuinely proves "a recent report
 * flags the summary". The banner is an `<output>` polite live region (implicit
 * `role="status"`, named by `aria-label="Recent incident warning"`), and the
 * pill/badge assertions below are role-scoped to that name because two
 * identical "Recent incident" chips exist on the page (the banner pill + the
 * hero's own incident badge, rendered by `SafetySummary`'s `"hero"` variant) —
 * an unscoped text locator would trip Playwright's strict mode.
 *
 * The data-layer guarantee that `occurredOn` round-trips as a `YYYY-MM-DD`
 * string so `findRecentIncident` actually flags it lives in
 * `app/server/incidents/index.ts` and is proven independently by
 * `tests/integration/incident-date-roundtrip.test.ts`.
 *
 * `occurredOn` is dated yesterday (UTC) so it is unambiguously inside the
 * 90-day recency window and strictly in the past — the schema rejects future
 * dates, and a yesterday date can never be read as "future" even if the
 * server/runner clock straddles a UTC-midnight boundary relative to the
 * browser. Self-skips without the CI E2E DB / session secret (see
 * fixtures.ts).
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
    // Open straight to the Incident-reports tab; the tab is URL-backed, so
    // `?tab=incidents` deep-links the incidents view where the empty state +
    // report form live. The recent-incident banner sits above the tabs, so it
    // is visible regardless of which tab is active.
    await page.goto(`/listings/${listingId}?tab=incidents`);
    await waitForHydration(page);

    // The banner's distinctive user-visible warning text — the real signal a
    // diner sees. (Its role/aria-label is covered by RecentIncidentBanner.test.tsx.)
    const bannerText = page.getByText(/A diner reported getting glutened here on/);

    // Before reporting: the honest empty state, no recent-incident banner.
    await expect(page.getByText("No glutened reports yet.")).toBeVisible();
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
    await expect(page.getByText("No glutened reports yet.")).toHaveCount(0);
    await expect(page.getByText("Cross-contamination reaction.")).toBeVisible();

    // The same invalidated query drives the recent-incident banner, so its
    // warning appears live (no reload). Generous timeout to absorb the refetch.
    // This proves "a recent report flags the summary" via the user-facing text.
    await expect(bannerText).toBeVisible({ timeout: 10000 });
    // The pill is a single-line "Recent incident" label; the relative recency
    // lives in the body sentence asserted above via `bannerText`. Scoped to
    // the banner's live region because the hero's own incident badge (in its
    // "Safety status" group) also renders an identical "Recent incident" chip
    // once the incident lands — an unscoped exact-text locator would match
    // both and trip Playwright's strict mode. The exact match guards against
    // an interpolated "Recent incident · N days ago" pill text.
    await expect(
      page
        .getByRole("status", { name: "Recent incident warning" })
        .getByText("Recent incident", { exact: true })
    ).toBeVisible();
    // The same fresh report also lights up the hero's own safety-badge row
    // (its incident chip, scoped via the labelled group) — the second surface
    // that "a recent report flags the listing".
    await expect(
      page
        .getByRole("group", { name: "Safety status" })
        .getByText("Recent incident", { exact: true })
    ).toBeVisible();
  });
});
