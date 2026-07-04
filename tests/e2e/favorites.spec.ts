import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";
import { waitForBrowseReady, waitForHydration } from "./helpers";

/**
 * Favorites — the feature end-to-end (issue AUB-130 / F12).
 *
 * Exercises the whole save loop through the REAL UI + server writes: the browse
 * card's heart ({@link FavoriteButton}) toggles a listing into the signed-in
 * viewer's favorites, the saved listing surfaces on `/favorites` AND behind the
 * directory's server-side "Saved" filter (`?saved=1`, the {@link FilterChips}
 * chip), unfavoriting drops it from both, and an ANONYMOUS heart click opens the
 * sign-in dialog WITHOUT persisting any favorite.
 *
 * AUTH: the signed-in portions reuse the repo's sealed-cookie sign-in — a seeded
 * `users` row + a cookie minted with the app's own `sealSessionPayload` (see
 * fixtures.ts), the exact primitive the OAuth callback writes — so no real Google
 * round-trip is needed.
 *
 * PAGINATION: the default browse order is alphabetical, page size 20. The seeded
 * listings carry a leading-digit name prefix (`0000-`/`0001-`) so they sort to the
 * FRONT of page 1 and are never paginated off by other runs' rows on the
 * persistent CI Neon branch. The `/favorites` + `?saved=1` views are already
 * scoped to the viewer's own favorites (a single listing here → one page), so the
 * saved-set assertions are pagination-independent; the negative assertions are
 * scoped to the unsaved listing's unique name.
 *
 * GATING + CLEANUP: every row is keyed on a unique per-run token, and the
 * {@link Seeder} tears down the listings (cascading to the app-written `favorites`
 * rows) and users it created. Both writing the cookie and seeding need the CI E2E
 * DATABASE_URL + SESSION_SECRET, so the spec self-skips when they are absent
 * (mirrors add-listing-authed / attest-claim). CI applies migrations first.
 */
test.describe("favorites — signed-in toggle, /favorites, saved filter", () => {
  let seeder: Seeder;
  let savedName: string;
  let savedId: string;
  let unsavedName: string;

  test.beforeEach(async ({ context, baseURL }) => {
    test.skip(!E2E_DB_READY, "needs CI E2E DATABASE_URL + SESSION_SECRET");
    seeder = new Seeder();

    // The listing we will favorite — leading-digit name pins it to the front of
    // page 1 so its card (and heart) is reliably on the loaded browse page.
    const savedToken = uniqueToken("fav");
    const saved = await seeder.createListing(savedToken, { name: `0000-${savedToken} Diner` });
    savedName = saved.name;
    savedId = saved.id;

    // A second, never-favorited listing — also pinned to page 1 so it appears in
    // the normal directory, proving the "Saved" filter is doing real work when it
    // is EXCLUDED from the saved view (scoped to its unique name, pagination-proof).
    const unsavedToken = uniqueToken("unsaved");
    const unsaved = await seeder.createListing(unsavedToken, {
      name: `0001-${unsavedToken} Diner`,
    });
    unsavedName = unsaved.name;

    const user = await seeder.createUser(uniqueToken("saver"));
    // biome-ignore lint/style/noNonNullAssertion: Playwright always provides baseURL from the config.
    await seeder.signIn(context, user.id, baseURL!);
  });

  test.afterEach(async () => {
    // Deleting the seeded listings cascades to the app-written `favorites` rows;
    // the seeded user is deleted separately. Nothing the spec created is left behind.
    await seeder?.cleanup();
  });

  test("favorite a card → it shows on /favorites and the Saved filter, then unfavorite drops it", async ({
    page,
  }) => {
    await page.goto("/");
    // Hydration + the route's search-param canonicalization must settle before the
    // heart's onClick is wired and before the Saved chip navigates.
    await waitForBrowseReady(page);

    // (1) Favorite from the card. The heart starts unsaved (aria-pressed=false);
    // clicking it flips the accessible label ("Save …" → "Saved, remove …") and
    // aria-pressed to true. We wait for it to re-enable (the write is disabled
    // while pending) so the server write has SETTLED before we navigate.
    const saveBtn = page.getByRole("button", { name: `Save ${savedName}` });
    await expect(saveBtn).toHaveAttribute("aria-pressed", "false");
    await saveBtn.click();

    const savedBtn = page.getByRole("button", { name: `Saved, remove ${savedName}` });
    await expect(savedBtn).toBeVisible();
    await expect(savedBtn).toHaveAttribute("aria-pressed", "true");
    await expect(savedBtn).toBeEnabled();

    // The unsaved listing is a real, visible result in the normal directory —
    // so its later ABSENCE from the saved view is meaningful, not just missing data.
    await expect(page.getByRole("link", { name: unsavedName })).toBeVisible();

    // (3) The "Saved" filter (server-side `?saved=1`). Click the sign-in-gated
    // chip (exact name "Saved" — never the cards' "Saved, remove …" hearts).
    await page.getByRole("button", { name: "Saved", exact: true }).click();
    // The app serializes the boolean search param as `saved=true` (TanStack Router);
    // a hand-typed `?saved=1` also works (the schema coerces both) — accept either.
    await expect(page).toHaveURL(/[?&]saved=(?:1|true)\b/);

    // The saved view contains EXACTLY the favorited listing (its card links to the
    // detail page) and EXCLUDES the unsaved one (scoped to its unique name).
    const savedCard = page.getByRole("link", { name: savedName });
    await expect(savedCard).toHaveAttribute("href", `/listings/${savedId}`);
    await expect(page.getByRole("heading", { name: unsavedName, level: 3 })).toHaveCount(0);

    // (2) The listing also appears on the dedicated /favorites page…
    await page.goto("/favorites");
    await waitForHydration(page);
    await expect(page.getByRole("link", { name: savedName })).toHaveAttribute(
      "href",
      `/listings/${savedId}`
    );
    await expect(page.getByRole("heading", { name: unsavedName, level: 3 })).toHaveCount(0);

    // (4) Unfavorite from the /favorites card — the label flips back to "Save …"
    // and aria-pressed to false. Wait for it to re-enable so the delete SETTLED.
    const removeBtn = page.getByRole("button", { name: `Saved, remove ${savedName}` });
    await removeBtn.click();
    const reSaveBtn = page.getByRole("button", { name: `Save ${savedName}` });
    await expect(reSaveBtn).toBeVisible();
    await expect(reSaveBtn).toHaveAttribute("aria-pressed", "false");
    await expect(reSaveBtn).toBeEnabled();

    // …and it DROPS from /favorites (the loader re-reads favorites on reload) —
    // it was the only favorite, so the "nothing saved" empty state now shows.
    await page.reload();
    await expect(page.getByRole("link", { name: savedName })).toHaveCount(0);
    await expect(page.getByText("No saved spots yet")).toBeVisible();

    // …and it DROPS from the Saved filter too (server-side re-query).
    await page.goto("/?saved=1");
    await expect(page.getByRole("heading", { name: savedName, level: 3 })).toHaveCount(0);
  });
});

/**
 * Anonymous heart click — the sign-in gate (F5). An unauthenticated viewer's
 * click opens the Radix sign-in dialog and attempts NO write: the favorite is
 * never persisted (asserted BOTH via a reload showing the heart still unsaved AND
 * directly against the DB — zero `favorites` rows for the listing).
 */
test.describe("favorites — anonymous heart opens sign-in dialog, no write", () => {
  let seeder: Seeder;
  let listingName: string;
  let listingId: string;

  test.beforeEach(async () => {
    test.skip(!E2E_DB_READY, "needs CI E2E DATABASE_URL + SESSION_SECRET");
    seeder = new Seeder();
    // No sign-in here — the viewer stays anonymous.
    const token = uniqueToken("anon");
    const listing = await seeder.createListing(token, { name: `0000-${token} Diner` });
    listingName = listing.name;
    listingId = listing.id;
  });

  test.afterEach(async () => {
    await seeder?.cleanup();
  });

  test("anonymous save click opens the sign-in dialog and writes nothing", async ({ page }) => {
    await page.goto("/");
    await waitForBrowseReady(page);

    // (5) Click the card's heart while anonymous → the sign-in dialog opens…
    await page.getByRole("button", { name: `Save ${listingName}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Sign in to save spots")).toBeVisible();

    // …and NO favorite was written. Directly assert zero `favorites` rows for the
    // listing — the anonymous click never reached the server (gated in the UI).
    const rows = await seeder.db
      .select()
      .from(schema.favorites)
      .where(eq(schema.favorites.listingId, listingId));
    expect(rows).toHaveLength(0);

    // A reload confirms nothing persisted: the heart is still the unsaved "Save …"
    // affordance with aria-pressed=false (never "Saved, remove …").
    await page.reload();
    await waitForBrowseReady(page);
    const heart = page.getByRole("button", { name: `Save ${listingName}` });
    await expect(heart).toBeVisible();
    await expect(heart).toHaveAttribute("aria-pressed", "false");
  });
});
