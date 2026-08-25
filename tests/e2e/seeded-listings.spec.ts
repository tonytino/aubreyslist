import { expect, test } from "@playwright/test";
import { seedListings } from "../../scripts/seed";
import { SEED_LISTINGS, type SeededListing } from "../../scripts/seed-data";
import { E2E_DB_READY, Seeder } from "./fixtures";
import { waitForBrowseSearchApplied, waitForHydration } from "./helpers";

/**
 * Standing coverage for seeded listings — the curated Denver set the curator
 * bot suggests labels for. Two guarantees under test:
 *
 *  1. Every directory card with live bot suggestions surfaces its provenance
 *     (the meta-row `bot-provenance` label), whether or not the card carries a
 *     celiac suggestion.
 *  2. Seeded listings' detail pages render — never a 500 from a database
 *     missing a silently skipped migration.
 *
 * This spec seeds the test database with the real baked seed data via the same
 * injectable core the CLI runs (`seedListings`, idempotent: Place-ID dedup +
 * claims `onConflictDoNothing`, so re-running against the persistent CI branch
 * is safe), then asserts both surfaces against deterministically chosen
 * targets derived from `SEED_LISTINGS` — never hardcoded restaurant names,
 * because the baked set gets re-curated.
 *
 * Seed persistence: seeded rows are deliberately not cleaned up — the seed is
 * the standing, idempotent dataset every environment carries (and deleting it
 * mid-run could race sibling specs). Other specs are already written to be
 * pagination/state-proof on the persistent CI branch (see favorites.spec.ts).
 *
 * Gating: self-skips (never fails) without the CI E2E DATABASE_URL +
 * SESSION_SECRET, like every DB-touching spec (fixtures.ts). No arbitrary
 * sleeps — web-first assertions + the shared hydration helpers only.
 */

/** The first seeded entry without a celiac suggestion. */
const nonCeliacTarget: SeededListing | undefined = SEED_LISTINGS.find(
  (entry) => !entry.suggestedAttributes.includes("celiac_safe")
);

/** The first seeded entry with a celiac suggestion. */
const celiacTarget: SeededListing | undefined = SEED_LISTINGS.find((entry) =>
  entry.suggestedAttributes.includes("celiac_safe")
);

test.describe("seeded listings — badge + detail page (AUB-196)", () => {
  // Declarative, group-level skips — evaluated once at collection time, so
  // they apply to every test in this file (unlike calling `test.skip(...)`
  // inside `beforeAll` itself, which only reliably marks the first test that
  // triggers the hook as skipped: beforeAll runs once per worker, and a
  // `TestSkipError` thrown from inside it does not retroactively skip the
  // other tests sharing that hook run).
  test.skip(!E2E_DB_READY, "needs CI E2E DATABASE_URL + SESSION_SECRET");
  test.skip(SEED_LISTINGS.length === 0, "no baked seed data — run pnpm db:seed:refresh");

  // Hoisted to beforeAll (not beforeEach): seedListings does up to ~140
  // sequential listing inserts + ~250 claim inserts, each an HTTP round trip to
  // Neon, so running it once per worker — rather than once per test — is both
  // cheaper and keeps individual tests within the default test timeout. This is safe
  // because the seed is idempotent (Place-ID dedup + claims
  // onConflictDoNothing) and beforeAll doesn't need the `page` fixture, so
  // re-running it across workers/re-runs on the persistent CI branch is a
  // cheap no-op after the first run and never clobbers a claim a real vote has
  // engaged with.
  test.beforeAll(async () => {
    // Generous headroom for the round trips above — well past the default 30s
    // test timeout this hook would otherwise share.
    test.setTimeout(300_000);
    const seeder = new Seeder();
    await seedListings(SEED_LISTINGS, { db: seeder.db });
  });

  test("a seeded card WITHOUT a celiac suggestion still shows the bot badge (AUB-193)", async ({
    page,
  }) => {
    test.skip(!nonCeliacTarget, "the baked seed set has no non-celiac-suggested entry");
    // biome-ignore lint/style/noNonNullAssertion: guarded by the skip above.
    const target = nonCeliacTarget!;

    // Free-text search pins the card onto page 1 regardless of how much other
    // state the persistent CI branch has accrued.
    await page.goto(`/?q=${encodeURIComponent(target.name)}`);
    await waitForBrowseSearchApplied(page, target.name);

    const card = page
      .locator("li")
      .filter({ has: page.getByRole("heading", { level: 3, name: target.name, exact: true }) })
      .first();
    await expect(card).toBeVisible();

    // No celiac suggestion → the card must still surface the bot provenance,
    // never a bare "Not yet attested". Target the meta-row label by testid:
    // the phrase alone need not be unique within a card, so a bare getByText
    // could trip Playwright's strict mode.
    await expect(card.getByTestId("bot-provenance")).toBeVisible();
    await expect(card.getByText("Not yet attested")).toHaveCount(0);
  });

  test("a seeded listing's detail page renders with its suggested claims visible", async ({
    page,
  }) => {
    test.skip(!nonCeliacTarget, "the baked seed set has no non-celiac-suggested entry");
    // biome-ignore lint/style/noNonNullAssertion: guarded by the skip above.
    const target = nonCeliacTarget!;

    await page.goto(`/?q=${encodeURIComponent(target.name)}`);
    await waitForBrowseSearchApplied(page, target.name);

    // Navigate through the real card link (the stretched-link covers the card).
    const card = page
      .locator("li")
      .filter({ has: page.getByRole("heading", { level: 3, name: target.name, exact: true }) })
      .first();
    await card.getByRole("link").first().click();

    // The listing detail page renders — never the error boundary or not-found.
    await expect(page).toHaveURL(/\/listings\//);
    await waitForHydration(page);
    await expect(
      page.getByRole("heading", { level: 1, name: target.name, exact: true })
    ).toBeVisible();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await expect(page.getByText("Listing not found")).toHaveCount(0);

    // The curator bot's suggested claim rows are visible on the evidence panel.
    await expect(page.getByText("Suggested by Aubrey's Bot").first()).toBeVisible();
  });

  test("a seeded card WITH a celiac suggestion shows the bot badge too", async ({ page }) => {
    test.skip(!celiacTarget, "the baked seed set has no celiac-suggested entry");
    // biome-ignore lint/style/noNonNullAssertion: guarded by the skip above.
    const target = celiacTarget!;

    await page.goto(`/?q=${encodeURIComponent(target.name)}`);
    await waitForBrowseSearchApplied(page, target.name);

    const card = page
      .locator("li")
      .filter({ has: page.getByRole("heading", { level: 3, name: target.name, exact: true }) })
      .first();
    await expect(card).toBeVisible();
    // Same strict-mode-safe targeting as the non-celiac case above.
    await expect(card.getByTestId("bot-provenance")).toBeVisible();
  });
});
