import { expect, test } from "@playwright/test";

import { waitForBrowseReady } from "./helpers";

/**
 * Smoke test for the browse/directory route (#33, AUB-61 redesign). Open to
 * anonymous visitors. The test DB content is not assumed (it may be empty or
 * seeded), so we assert the directory chrome renders and EITHER listing cards OR
 * one of the honest empty/no-results states — never a fabricated count.
 *
 * AUB-198 retired the "Filter listings" bottom sheet: the server-side taxonomy
 * filter renders as toggle chips and the sort as a labelled select chip, all
 * directly in the filter chip row — so the sort/filter tests interact with the
 * row itself (no sheet to open).
 */
test("browse directory renders for anonymous visitors", async ({ page }) => {
  // The directory is the home page now (AUB-116).
  await page.goto("/");

  // The search now leads the filter chip row as a collapsed chip (user feedback
  // #5); its presence proves the directory chrome rendered.
  await expect(page.getByRole("button", { name: "Search restaurants" })).toBeVisible();

  // Either there are cards (a result list) or an honest empty/no-results heading.
  const resultsList = page.getByRole("list");
  const emptyState = page.getByRole("heading", {
    name: /Let's find your safe table|No spots match/,
  });
  await expect(resultsList.or(emptyState).first()).toBeVisible();
});

test("/listings redirects to the directory at /", async ({ page }) => {
  // The old directory URL now permanently redirects to `/` (AUB-116). The
  // beforeLoad redirect forwards the validated search, but `stripSearchParams` on
  // the target route drops every param equal to its default, so a bare `/listings`
  // lands on a clean `/`. Tolerate either a bare `/` or a trailing query string.
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
 * Prebuilt quick filter (AUB-135). A quick chip is now a URL-driven, server-side
 * filter, so applying it writes `?quick=` and it survives a full reload / shared
 * link — the bug this fixes was that the chip lived in local state and vanished on
 * rerender. DB-agnostic: we assert the URL + the chip's pressed state, not results.
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
 * Sort control (#36, chip row since AUB-198). The labelled `<select>` chip sits
 * directly in the filter row; choosing a sort drives the URL (`?sort=`) so the
 * view stays linkable, mirroring the `?page=`/`?attrs=` pattern. We assert the
 * accessible labeled control and the URL wiring; the page-reset on sort change is
 * covered by unit tests.
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

  // Back to the default returns the list to alphabetical order AND strips `sort`
  // from the URL entirely (stripSearchParams drops any param equal to its default),
  // so the bar reads as a clean `/` rather than carrying redundant `?sort=alpha`.
  await sort.selectOption("alpha");
  await expect(page).not.toHaveURL(/sort=/);
});

/**
 * Taxonomy filter (#35) and sort (#36) compose: applying a filter and then a
 * sort keeps BOTH params in the URL (they are orthogonal). Guards the merge of
 * the two parallel features. Both controls live directly in the chip row now
 * (AUB-198) — the taxonomy filter as toggle chips, the sort as a select chip.
 */
test("filter and sort compose in the URL", async ({ page }) => {
  await page.goto("/");
  await waitForBrowseReady(page);

  // Toggle a taxonomy chip (the server-side consensus filter from #35). The chip
  // is URL-controlled (`aria-pressed` derives from `?attrs=`), so the click fires
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
