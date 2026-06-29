import { expect, test } from "@playwright/test";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";

/**
 * Mocked sign-in (issue #45).
 *
 * The repo's session is a sealed, server-signed cookie (ADR-006) — there is no
 * `sessions` table — so an authenticated state is established by minting that
 * cookie for a seeded user with the repo's OWN `sealSessionPayload` (the exact
 * seal the Google OAuth callback writes), rather than driving the off-site OAuth
 * round-trip. See `tests/e2e/fixtures.ts`.
 *
 * We assert the authenticated state two ways: the header no longer offers
 * "Continue with Google", and a gated surface (add-listing) renders the intake
 * form instead of the sign-in prompt an anonymous visitor sees
 * (`add-listing.spec.ts` covers the anonymous side).
 */
test.describe("mocked Google sign-in", () => {
  let seeder: Seeder;

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

    // The header now shows the authenticated state: the visitor's name + a
    // "Sign out" control, and NOT the anonymous "Continue with Google" entry.
    await page.goto("/");
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Continue with Google" })).toHaveCount(0);
    await expect(header.getByText(user.name)).toBeVisible();
    await expect(header.getByRole("button", { name: "Sign out" })).toBeVisible();

    // A gated surface now renders its authenticated form, not the sign-in prompt.
    await page.goto("/listings/new");
    await expect(page.getByRole("heading", { name: "Add a restaurant" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Sign in to add a restaurant" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add listing" })).toBeVisible();
  });
});
