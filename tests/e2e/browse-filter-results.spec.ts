import { expect, test } from "@playwright/test";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";
import { openBrowseFilters } from "./helpers";

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
 * PAGINATION-PROOF (the persistent CI Neon branch accrues data across runs): the
 * default browse order is alphabetical with a page size of 20, so a both-attribute
 * listing with a random name could be pushed past page 1 by other runs' data and
 * silently fail this assertion. We therefore (a) name the seeded match with a
 * leading-digit prefix so it sorts to the FRONT of page 1 under the alpha default
 * across the default Postgres collation, and (b) assert membership via its
 * listing-detail card LINK (the `/listings/<id>` href) and CLICK through to its
 * detail page — proving it is a real, navigable result rather than just text on a
 * page. The negative assertion stays scoped to the celiac-only listing's unique
 * name. Reads are anonymous, but seeding needs the DB; the spec self-skips when
 * the CI E2E database / session secret are absent (see fixtures.ts).
 */
test.describe("browse + GF taxonomy filter (seeded results)", () => {
  let seeder: Seeder;
  let bothName: string;
  let bothId: string;
  let celiacOnlyName: string;

  test.beforeEach(async () => {
    test.skip(!E2E_DB_READY, "needs CI E2E DATABASE_URL + SESSION_SECRET");
    seeder = new Seeder();

    // Listing A: celiac-safe AND dedicated-fryer, both with a confirm majority.
    // Leading-digit name sorts to the front of page 1 (alpha default) so it is
    // never paginated off by other runs' rows on the persistent branch.
    const bothToken = uniqueToken("both");
    const both = await seeder.createListing(bothToken, { name: `0000-${bothToken} Diner` });
    bothName = both.name;
    bothId = both.id;
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
    // The taxonomy filter lives in the "Filters" bottom sheet in the AUB-61
    // redesign; open it before toggling the attribute checkboxes.
    await openBrowseFilters(page);

    // Apply both taxonomy checkboxes (labels come from CLAIM_ATTRIBUTE_LABELS).
    // click() (not check()) — the checkbox is URL-controlled and re-renders on
    // navigation, so the URL is the source of truth (matches browse.spec.ts).
    await page.getByRole("checkbox", { name: "Celiac-safe", exact: true }).click();
    await expect(page).toHaveURL(/attrs=celiac_safe_vs_gluten_friendly/);

    await page.getByRole("checkbox", { name: "Dedicated fryer" }).click();
    await expect(page).toHaveURL(/attrs=[^&]*dedicated_fryer/);

    // Close the filter sheet so the filtered result list underneath is visible.
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    // The celiac-only listing is excluded by the dedicated-fryer constraint —
    // scoped to its unique name, robust regardless of pagination.
    await expect(page.getByRole("heading", { name: celiacOnlyName, level: 3 })).toHaveCount(0);

    // The both-attribute listing IS a result: its card links to its detail page.
    // The leading-digit name pins it to page 1, so the link is in the DOM. Assert
    // the link by its detail href, then click through to confirm it is a real,
    // navigable filtered result (URL-based, not just on-page text).
    const card = page.getByRole("link", { name: bothName });
    await expect(card).toHaveAttribute("href", `/listings/${bothId}`);
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/listings/${bothId}$`));
    await expect(page.getByRole("heading", { name: bothName, level: 1 })).toBeVisible();
  });

  /**
   * Server-side search covers ALL listings, not just the loaded page. We seed a
   * listing whose name sorts to the very END of the alphabetical default order
   * (a `zzzz-` prefix), so on any populated branch it is paginated OFF page 1.
   * Searching its unique token from the directory (URL `?q=`) must still surface
   * it — proving the redesign routes free-text search through the server and can
   * find a match that isn't on the first page (an honesty requirement: a page-
   * scoped client filter would have hidden it).
   */
  test("server-side search finds a listing that isn't on page 1", async ({ page }) => {
    const lateToken = uniqueToken("zsearch");
    const late = await seeder.createListing(lateToken, { name: `zzzz-${lateToken} Diner` });

    await page.goto("/listings");
    // Type the unique token into the directory search; the route debounces it into
    // the URL `?q=`, which runs the server ILIKE over name + address.
    await page.getByRole("searchbox", { name: "Search listings" }).fill(lateToken);
    await expect(page).toHaveURL(new RegExp(`q=[^&]*${lateToken}`));

    // The card for the late-sorting listing is present even though it would never
    // appear on page 1 without a query — the search reached beyond the first page.
    const card = page.getByRole("link", { name: late.name });
    await expect(card).toHaveAttribute("href", `/listings/${late.id}`);

    // And the honest count reflects the server-filtered total (a single match),
    // not a page-scoped number.
    await expect(page.getByText(/\bplaces near\b/)).toContainText("1");
  });
});
