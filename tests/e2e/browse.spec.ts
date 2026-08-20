import { expect, test } from "@playwright/test";

import { waitForBrowseReady } from "./helpers";

/**
 * Smoke test for the browse/directory route. Open to anonymous visitors. The
 * test DB content is not assumed (it may be empty or seeded), so we assert the
 * directory chrome renders and either listing cards or one of the honest
 * empty/no-results states — never a fabricated count.
 *
 * The server-side taxonomy filter renders as toggle chips and the sort as a
 * labelled select chip, all directly in the filter chip row — so the
 * sort/filter tests interact with the row itself (no sheet to open).
 */
test("browse directory renders for anonymous visitors", async ({ page }) => {
  // The directory is the home page.
  await page.goto("/");

  // The search leads the filter chip row as a collapsed chip; its presence
  // proves the directory chrome rendered.
  await expect(page.getByRole("button", { name: "Search restaurants" })).toBeVisible();

  // Either there are cards (a result list) or an honest empty/no-results heading.
  const resultsList = page.getByRole("list");
  const emptyState = page.getByRole("heading", {
    name: /Let's find your safe table|No spots match/,
  });
  await expect(resultsList.or(emptyState).first()).toBeVisible();
});

test("/listings redirects to the directory at /", async ({ page }) => {
  // `/listings` permanently redirects to `/`. The beforeLoad redirect forwards
  // the validated search, but `stripSearchParams` on the target route drops
  // every param equal to its default, so a bare `/listings` lands on a clean
  // `/`. Tolerate either a bare `/` or a trailing query string.
  await page.goto("/listings");
  await expect(page).toHaveURL(/^[^?]*\/(\?|$)/);
  await expect(page).not.toHaveURL(/\/listings/);
  await expect(page.getByRole("button", { name: "Search restaurants" })).toBeVisible();
});

test("/listings redirect preserves search params", async ({ page }) => {
  // A shared `/listings?…` link keeps its params through the redirect to `/`
  // (routing.md smoke-test guidance).
  await page.goto("/listings?page=2&sort=trust");
  await expect(page).toHaveURL(/^[^?]*\/\?/);
  await expect(page).not.toHaveURL(/\/listings/);
  await expect(page).toHaveURL(/page=2/);
  await expect(page).toHaveURL(/sort=trust/);
});

/**
 * Prebuilt quick filter. A quick chip is a URL-driven, server-side filter:
 * applying it writes `?quick=` and it survives a full reload / shared link — a
 * chip held only in local state would vanish on rerender. DB-agnostic: we
 * assert the URL + the chip's pressed state, not results.
 */
test("a quick chip persists in the URL and across a reload", async ({ page }) => {
  await page.goto("/");
  await waitForBrowseReady(page);

  const celiac = page.getByRole("button", { name: "Celiac-safe" });
  await celiac.click();
  await expect(page).toHaveURL(/[?&]quick=celiac/);
  await expect(celiac).toHaveAttribute("aria-pressed", "true");

  // The real test: reload the page. The chip must come back active from the URL
  // (it is derived from `?quick=`, not held in client state that a reload discards).
  await page.reload();
  await waitForBrowseReady(page);
  await expect(page).toHaveURL(/[?&]quick=celiac/);
  await expect(page.getByRole("button", { name: "Celiac-safe" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  // Toggling it off clears the param (no default → stripped) — a clean URL again.
  await page.getByRole("button", { name: "Celiac-safe" }).click();
  await expect(page).not.toHaveURL(/quick=/);
});

/**
 * List/Map view toggle (the map itself is a placeholder). `view` is
 * client-only URL state (never in `loaderDeps`), but it's still a validated
 * search param per the Hard Rule, so it must persist across a reload exactly
 * like the quick-filter chip above, and the default ("list") must be stripped
 * from the URL at rest.
 */
test("the list/map view toggle persists in the URL and across a reload", async ({ page }) => {
  await page.goto("/");
  await waitForBrowseReady(page);

  // Scope to the toggle's own group (named by its sr-only <legend>) and use
  // exact names. Playwright's `name` is a case-insensitive substring match by
  // default, so a bare `name: "Map"` would also match the map view's "Recenter
  // map" button (DirectoryMap.tsx) once pins render, and `name: "List"` would
  // match the "Add listing" FAB — both strict-mode violations.
  const toggle = page.getByRole("group", { name: "Choose list or map view" });
  const listButton = toggle.getByRole("button", { name: "List", exact: true });
  const mapButton = toggle.getByRole("button", { name: "Map", exact: true });
  await expect(listButton).toHaveAttribute("aria-pressed", "true");

  await mapButton.click();
  await expect(page).toHaveURL(/[?&]view=map/);
  await expect(mapButton).toHaveAttribute("aria-pressed", "true");
  // Content is DB-agnostic here (test data may be empty): the map view only
  // renders in place of an honest empty/no-results state, so we don't assert the
  // placeholder map's carousel — just the toggle + URL wiring (see the smoke
  // test above for the DB-agnostic content pattern).

  // Reload: the view must come back from the URL, not vanish to a local default.
  await page.reload();
  await waitForBrowseReady(page);
  await expect(page).toHaveURL(/[?&]view=map/);
  await expect(mapButton).toHaveAttribute("aria-pressed", "true");

  // Back to List strips the default param entirely (stripSearchParams).
  await listButton.click();
  await expect(page).not.toHaveURL(/view=/);
});

/**
 * Sort control. The labelled `<select>` chip sits directly in the filter row;
 * choosing a sort drives the URL (`?sort=`) so the view stays linkable,
 * mirroring the `?page=`/`?attrs=` pattern. We assert the accessible labeled
 * control and the URL wiring; the page-reset on sort change is covered by unit
 * tests.
 */
test("browse sort control is labeled and drives the URL", async ({ page }) => {
  await page.goto("/");
  await waitForBrowseReady(page);

  const sort = page.getByLabel("Sort by");
  await expect(sort).toBeVisible();

  await sort.selectOption("trust");
  await expect(page).toHaveURL(/sort=trust/);

  await sort.selectOption("recency");
  await expect(page).toHaveURL(/sort=recency/);

  // Back to the default returns the list to alphabetical order and strips `sort`
  // from the URL entirely (stripSearchParams drops any param equal to its default),
  // so the bar reads as a clean `/` rather than carrying redundant `?sort=alpha`.
  await sort.selectOption("alpha");
  await expect(page).not.toHaveURL(/sort=/);
});

/**
 * Taxonomy filter and sort compose: applying a filter and then a sort keeps
 * both params in the URL (they are orthogonal). Both controls live directly in
 * the chip row — the taxonomy filter as toggle chips, the sort as a select
 * chip.
 */
test("filter and sort compose in the URL", async ({ page }) => {
  await page.goto("/");
  await waitForBrowseReady(page);

  // Toggle a taxonomy chip (the server-side consensus filter). The chip is
  // URL-controlled (`aria-pressed` derives from `?attrs=`), so the click fires
  // a navigation that re-renders it pressed.
  const fryerChip = page.getByRole("button", { name: "Dedicated fryer" });
  await expect(fryerChip).toBeVisible();
  await fryerChip.click();
  await expect(page).toHaveURL(/attrs=dedicated_fryer/);
  await expect(page.getByRole("button", { name: "Dedicated fryer" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  // Now sort; the filter param must survive alongside the new sort param.
  await page.getByLabel("Sort by").selectOption("trust");
  await expect(page).toHaveURL(/sort=trust/);
  await expect(page).toHaveURL(/attrs=/);
});
