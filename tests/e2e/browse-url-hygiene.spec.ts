import { expect, test } from "@playwright/test";

import { waitForBrowseReady } from "./helpers";

/**
 * URL hygiene for the directory. The directory route applies
 * `stripSearchParams(BROWSE_SEARCH_DEFAULTS)`, so params equal to their default
 * (`page=1`, `attrs=`, `q=`, `sort=distance`, `radius=25`, `view=list`) never appear
 * in the URL — at rest, after an interaction, or on a shared link. These assert
 * the URL stays clean; the schema-vs-strip-map drift guard is a unit test
 * (`app/listings/browse-search.test.ts`).
 *
 * Matches the DB-agnostic style of `browse.spec.ts`: we only assert URL shape and
 * the directory chrome, never a fabricated count or seeded content.
 */
test("a bare visit to the directory carries no query string", async ({ page }) => {
  await page.goto("/");
  await waitForBrowseReady(page);

  // No `?page=1&sort=distance&radius=25` noise — the bar reads as a clean `/`.
  // The visitor's coordinates never appear either: location is route state,
  // not a search param, so a distance-sorted view still shares as a bare `/`.
  await expect(page).toHaveURL(/^[^?]*\/$/);
  await expect(page).not.toHaveURL(/lat=|lng=/);
});

test("only non-default params are written to the URL", async ({ page }) => {
  await page.goto("/");
  await waitForBrowseReady(page);

  // A non-default sort (via the sort chip in the filter row) is a real,
  // shareable choice → it appears...
  await page.getByLabel("Sort by").selectOption("trust");
  await expect(page).toHaveURL(/[?&]sort=trust/);

  // ...but the defaults it travels alongside do not leak in.
  await expect(page).not.toHaveURL(/page=1/);
  await expect(page).not.toHaveURL(/radius=25/);
  await expect(page).not.toHaveURL(/attrs=/);
  await expect(page).not.toHaveURL(/[?&]q=/);
});

test("a shared link carrying default params is canonicalized to a clean URL", async ({ page }) => {
  // A pasted or hand-typed link may carry default-param noise. It must still
  // load, and the router normalizes it to the stripped, canonical shape on the
  // way in (search middleware runs on initial location build, not just
  // explicit navigations).
  await page.goto("/?page=1&attrs=&q=&sort=distance&radius=25&view=list");
  await waitForBrowseReady(page);

  await expect(page).toHaveURL(/^[^?]*\/$/);
});
