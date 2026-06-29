import { expect, test } from "@playwright/test";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";
import { waitForBrowseReady } from "./helpers";

/**
 * Browse + filter, with REAL seeded results (issue #45).
 *
 * The existing `browse.spec.ts` asserts the filter/sort URL WIRING but never
 * that a filter narrows the list to matching listings — it can't, since it
 * assumes no seeded data. This spec seeds a listing that the community has
 * affirmed for BOTH `celiac_safe_vs_gluten_friendly` and `dedicated_fryer` (a
 * filter only matches when confirms outnumber disputes — see
 * `app/server/listings/filter.ts`), applies that exact "celiac-safe + dedicated
 * fryer" filter, and asserts the URL carries both attrs AND the seeded listing
 * is in the results. A second listing affirmed ONLY for celiac-safe is seeded so
 * the dedicated-fryer constraint is doing real work (it must be excluded).
 *
 * Reads are anonymous, but seeding needs the DB; the spec self-skips when the
 * CI E2E database / session secret are absent (see fixtures.ts).
 */
test.describe("browse + GF taxonomy filter (seeded results)", () => {
  let seeder: Seeder;
  let bothName: string;
  let celiacOnlyName: string;

  test.beforeEach(async () => {
    test.skip(!E2E_DB_READY, "needs CI E2E DATABASE_URL + SESSION_SECRET");
    seeder = new Seeder();

    // Listing A: celiac-safe AND dedicated-fryer, both with a confirm majority.
    const both = await seeder.createListing(uniqueToken("both"));
    bothName = both.name;
    const celiacClaim = await seeder.createClaim(both.id, "celiac_safe_vs_gluten_friendly");
    const fryerClaim = await seeder.createClaim(both.id, "dedicated_fryer");
    await seeder.attest(celiacClaim.id, "confirm", uniqueToken("v"));
    await seeder.attest(fryerClaim.id, "confirm", uniqueToken("v"));

    // Listing B: celiac-safe ONLY — must be filtered OUT by the fryer constraint.
    const celiacOnly = await seeder.createListing(uniqueToken("celiaconly"));
    celiacOnlyName = celiacOnly.name;
    const onlyCeliacClaim = await seeder.createClaim(
      celiacOnly.id,
      "celiac_safe_vs_gluten_friendly"
    );
    await seeder.attest(onlyCeliacClaim.id, "confirm", uniqueToken("v"));
  });

  test.afterEach(async () => {
    await seeder?.cleanup();
  });

  test("celiac-safe + dedicated fryer filter narrows to the matching listing", async ({ page }) => {
    await page.goto("/listings");
    await waitForBrowseReady(page);

    // Apply both taxonomy checkboxes (labels come from CLAIM_ATTRIBUTE_LABELS).
    // click() (not check()) — the checkbox is URL-controlled and re-renders on
    // navigation, so the URL is the source of truth (matches browse.spec.ts).
    await page.getByRole("checkbox", { name: "Celiac-safe vs. gluten-friendly" }).click();
    await expect(page).toHaveURL(/attrs=celiac_safe_vs_gluten_friendly/);

    await page.getByRole("checkbox", { name: "Dedicated fryer" }).click();
    await expect(page).toHaveURL(/attrs=[^&]*dedicated_fryer/);

    // The listing affirmed for BOTH attributes is in the results…
    await expect(page.getByRole("heading", { name: bothName, level: 3 })).toBeVisible();
    // …and the celiac-only listing is excluded by the dedicated-fryer constraint.
    await expect(page.getByRole("heading", { name: celiacOnlyName, level: 3 })).toHaveCount(0);
  });
});
