import { expect, test } from "@playwright/test";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";

/**
 * Mocked sign-in.
 *
 * The repo's session is a sealed, server-signed cookie (ADR-006) — there is no
 * `sessions` table — so an authenticated state is established by minting that
 * cookie for a seeded user with the repo's own `sealSessionPayload` (the exact
 * seal the Google OAuth callback writes), rather than driving the off-site
 * OAuth round-trip. See `tests/e2e/fixtures.ts`.
 *
 * We assert the authenticated state two ways: the header offers no "Continue
 * with Google", and a gated surface (add-listing) renders the intake form
 * instead of the sign-in prompt an anonymous visitor sees
 * (`add-listing.spec.ts` covers the anonymous side).
 */
test.describe("mocked Google sign-in", () => {
  let seeder: Seeder;

  // Assert the authenticated header at the mobile width, where the account
  // controls fold into the combined menu (its trigger carries the signed-in
  // name); 375px is the minimum supported width.
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(async () => {
    test.skip(!E2E_DB_READY, "needs CI E2E DATABASE_URL + SESSION_SECRET");
    seeder = new Seeder();
  });

  test.afterEach(async () => {
    await seeder?.cleanup();
  });

  test("a sealed session cookie authenticates the visitor", async ({ page, context, baseURL }) => {
    // Manual intake keeps the gated add-listing form key-free + deterministic.
    await seeder.setIntakeMode("manual");
    const user = await seeder.createUser(uniqueToken("signin"));
    // biome-ignore lint/style/noNonNullAssertion: Playwright always provides baseURL from the config.
    await seeder.signIn(context, user.id, baseURL!);

    // The header shows the authenticated state via the combined-menu trigger,
    // whose accessible name carries the visitor's name — not the anonymous
    // "Log in" entry. The menu's contents (name, moderation/admin link, sign
    // out) are covered by SiteMenu/UserMenu unit tests; this e2e only needs to
    // confirm the sealed cookie produces the authenticated header for this
    // user. We assert it from the server-rendered trigger, so it doesn't
    // depend on hydration timing (opening the portal'd menu would).
    await page.goto("/");
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Log in" })).toHaveCount(0);
    await expect(
      header.getByRole("button", { name: `Open menu, signed in as ${user.name}` })
    ).toBeVisible();

    // A gated surface renders its authenticated intake wizard, not the
    // sign-in prompt. Step 0's manual finder ("Restaurant name" field) is
    // server-rendered, so this holds without waiting on hydration.
    await page.goto("/listings/new");
    await expect(page.getByRole("heading", { name: "Add a restaurant" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Sign in to add a restaurant" })).toHaveCount(0);
    await expect(page.getByLabel("Restaurant name")).toBeVisible();
  });
});
