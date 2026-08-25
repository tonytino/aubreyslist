import { expect, test } from "@playwright/test";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";
import { waitForBrowseReady } from "./helpers";

/**
 * Browse + filter, with real seeded results.
 *
 * `browse.spec.ts` asserts the filter/sort URL wiring but never that a filter
 * narrows the list to matching listings — it can't, since it assumes no seeded
 * data. This spec seeds a listing the community has affirmed for both
 * `celiac_safe` and `dedicated_fryer`, applies the visible
 * "Celiac-safe + Dedicated fryer" combination from the chip row, and asserts
 * the URL carries both params and the seeded listing is in the results. A
 * second listing affirmed only for celiac-safe is seeded so the
 * dedicated-fryer constraint is doing real work (it must be excluded).
 *
 * Chip row: "Celiac-safe" is the quick chip (`?quick=celiac` — the headline
 * taxonomy attribute is deliberately not duplicated as a taxonomy chip; the
 * quick chip is the stricter reading, also requiring a fresh consensus, which
 * the just-seeded confirms satisfy). "Dedicated fryer" is a taxonomy toggle
 * chip (`?attrs=dedicated_fryer`, positive-consensus filter — see
 * `app/server/listings/filter.ts`). The two AND-compose server-side.
 *
 * Pagination-proof (the persistent CI Neon branch accrues data across runs):
 * the default browse order is alphabetical with a page size of 20, so a
 * both-attribute listing with a random name could be pushed past page 1 by
 * other runs' data and silently fail this assertion. So (a) the seeded match
 * gets a leading-digit name that sorts to the front of page 1 under the alpha
 * default across the default Postgres collation, and (b) membership is
 * asserted via its listing-detail card link (the `/listings/<id>` href) plus a
 * click through to its detail page — proving it is a real, navigable result
 * rather than just text on a page. The negative assertion stays scoped to the
 * celiac-only listing's unique name. Reads are anonymous, but seeding needs
 * the DB; the spec self-skips when the CI E2E database / session secret are
 * absent (see fixtures.ts).
 */
test.describe("browse + GF taxonomy filter (seeded results)", () => {
  let seeder: Seeder;
  let bothName: string;
  let bothId: string;
  let celiacOnlyName: string;

  test.beforeEach(async () => {
    test.skip(!E2E_DB_READY, "needs CI E2E DATABASE_URL + SESSION_SECRET");
    seeder = new Seeder();

    // Listing A: celiac-safe and dedicated-fryer, both with a confirm majority.
    // Leading-digit name sorts to the front of page 1 (alpha default) so it is
    // never paginated off by other runs' rows on the persistent branch.
    const bothToken = uniqueToken("both");
    const both = await seeder.createListing(bothToken, { name: `0000-${bothToken} Diner` });
    bothName = both.name;
    bothId = both.id;
    const celiacClaim = await seeder.createClaim(both.id, "celiac_safe");
    const fryerClaim = await seeder.createClaim(both.id, "dedicated_fryer");
    await seeder.attest(celiacClaim.id, "confirm", uniqueToken("v"));
    await seeder.attest(fryerClaim.id, "confirm", uniqueToken("v"));

    // Listing B: celiac-safe only — must be filtered out by the fryer constraint.
    const celiacOnly = await seeder.createListing(uniqueToken("celiaconly"));
    celiacOnlyName = celiacOnly.name;
    const onlyCeliacClaim = await seeder.createClaim(celiacOnly.id, "celiac_safe");
    await seeder.attest(onlyCeliacClaim.id, "confirm", uniqueToken("v"));
  });

  test.afterEach(async () => {
    await seeder?.cleanup();
  });

  test("celiac-safe + dedicated fryer filter narrows to the matching listing", async ({ page }) => {
    await page.goto("/");
    // Both filters are toggle chips directly in the row; wait for hydration so
    // their click handlers are wired before toggling.
    await waitForBrowseReady(page);

    // The quick "Celiac-safe" chip — the single visible celiac-safe control
    // (`?quick=celiac`, fresh confirm-majority; the just-seeded confirm is fresh).
    await page.getByRole("button", { name: "Celiac-safe" }).click();
    await expect(page).toHaveURL(/[?&]quick=celiac/);

    // The "Dedicated fryer" taxonomy chip (`?attrs=`, positive consensus). The
    // chips are URL-controlled and re-render on navigation, so the URL is the
    // source of truth (matches browse.spec.ts).
    await page.getByRole("button", { name: "Dedicated fryer" }).click();
    await expect(page).toHaveURL(/attrs=dedicated_fryer/);

    // The celiac-only listing is excluded by the dedicated-fryer constraint —
    // scoped to its unique name, robust regardless of pagination.
    await expect(page.getByRole("heading", { name: celiacOnlyName, level: 3 })).toHaveCount(0);

    // The both-attribute listing is a result: its card links to its detail page.
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
   * Server-side search covers all listings, not just the loaded page. We seed
   * a listing whose name sorts to the very end of the alphabetical default
   * order (a `zzzz-` prefix), so on any populated branch it is paginated off
   * page 1. Searching its unique token from the directory (URL `?q=`) must
   * still surface it — proving free-text search runs through the server and
   * can find a match that isn't on the first page (an honesty requirement: a
   * page-scoped client filter would hide it).
   */
  test("server-side search finds a listing that isn't on page 1", async ({ page }) => {
    const lateToken = uniqueToken("zsearch");
    const late = await seeder.createListing(lateToken, { name: `zzzz-${lateToken} Diner` });

    await page.goto("/");
    // Wait for hydration + the route's search-param canonicalization before typing —
    // otherwise the debounced `?q=` navigate races the not-yet-wired input onChange
    // (and the in-flight canonicalizing navigate clobbers it), leaving `q=` empty.
    await waitForBrowseReady(page);
    // Search is the first chip in the filter row: click the collapsed "Search
    // restaurants" chip to expand its input, then type the unique token. The
    // route debounces it into the URL `?q=`, running the server ILIKE over
    // name + address.
    await page.getByRole("button", { name: "Search restaurants" }).click();
    await page.getByRole("searchbox", { name: "Search restaurants" }).fill(lateToken);
    await expect(page).toHaveURL(new RegExp(`q=[^&]*${lateToken}`));

    // The card for the late-sorting listing is present even though it would never
    // appear on page 1 without a query — the search reached beyond the first page.
    // No visible count line exists to assert on, so this beyond-page-1 result is
    // the proof that search is server-complete.
    const card = page.getByRole("link", { name: late.name });
    await expect(card).toHaveAttribute("href", `/listings/${late.id}`);
  });
});
