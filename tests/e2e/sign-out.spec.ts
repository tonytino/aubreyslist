import { expect, test } from "@playwright/test";

import { SESSION_COOKIE_NAME } from "~/server/auth/session";
import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";
import { waitForHydration } from "./helpers";

/**
 * Sign-out — the POST /api/auth/sign-out path end-to-end.
 *
 * The account menu's "Sign out" control is a real form POST (UserMenu: a
 * `<form method="post" action="/api/auth/sign-out">` wrapping the submit
 * button), which clears the sealed session cookie server-side and redirects
 * home (`app/server/routes/auth.ts`). This spec drives that through the real UI:
 * sign in with the repo's sealed-cookie fixture, open the avatar account menu,
 * click "Sign out", and assert the visitor is logged out — the header's anonymous
 * "Log in" affordance returns, the account menu is gone, and the session cookie
 * is cleared from the browser context.
 *
 * Auth: reuses the sealed-cookie sign-in (a seeded `users` row + a cookie minted
 * with the app's own `sealSessionPayload`, the exact primitive the OAuth callback
 * writes — see fixtures.ts), so no real Google round-trip is needed.
 *
 * Gating + cleanup: the seeded user is keyed on a unique per-run token and torn
 * down in afterEach. Both minting the cookie and seeding need the CI E2E
 * DATABASE_URL + SESSION_SECRET, so the spec self-skips when they are absent
 * (mirrors sign-in / favorites). CI applies migrations first.
 */
test.describe("sign-out — account menu POST clears the session", () => {
  let seeder: Seeder;

  test.beforeEach(async () => {
    test.skip(!E2E_DB_READY, "needs CI E2E DATABASE_URL + SESSION_SECRET");
    seeder = new Seeder();
  });

  test.afterEach(async () => {
    await seeder?.cleanup();
  });

  test("signed-in user signs out and lands logged out on the home page", async ({
    page,
    context,
    baseURL,
  }) => {
    const user = await seeder.createUser(uniqueToken("signout"));
    // biome-ignore lint/style/noNonNullAssertion: Playwright always provides baseURL from the config.
    await seeder.signIn(context, user.id, baseURL!);

    await page.goto("/");
    // The account menu is a portaled Radix dropdown — its trigger only opens once
    // the client has hydrated, so wait for the interactive signal before clicking.
    await waitForHydration(page);

    const header = page.getByRole("banner");
    // Precondition: the authenticated header shows this user's account menu, not
    // the anonymous "Log in" entry.
    await expect(header.getByRole("link", { name: "Log in" })).toHaveCount(0);
    await header.getByRole("button", { name: `Account menu for ${user.name}` }).click();

    // The menu's "Sign out" item is a submit button (role=menuitem via Radix's
    // asChild) that POSTs the sign-out form; the server clears the cookie and
    // redirects home.
    await page.getByRole("menuitem", { name: "Sign out" }).click();

    // Logged out: back on the home page with the anonymous "Log in" affordance,
    // and the account menu gone.
    await expect(page).toHaveURL(/\/$/);
    await expect(header.getByRole("link", { name: "Log in" })).toBeVisible();
    await expect(header.getByRole("button", { name: `Account menu for ${user.name}` })).toHaveCount(
      0
    );

    // The sealed session cookie is cleared from the browser context, so a
    // subsequent request would be anonymous (the redirect's Set-Cookie expired it).
    const sessionCookie = (await context.cookies()).find((c) => c.name === SESSION_COOKIE_NAME);
    expect(sessionCookie?.value ?? "").toBe("");
  });
});
