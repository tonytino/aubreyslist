import { expect, test } from "@playwright/test";

// The admin panel is gated server-side in the route loader (ADR-010). An
// anonymous visitor is redirected away to sign in before the shell renders, so
// they never see the admin UI. We assert the *absence* of the panel rather than
// the redirect target, because the sign-in route initiates a real Google OAuth
// redirect (off-site, env-dependent) that a hermetic smoke test should not
// follow. The granted (admin/moderator) views are covered by component tests
// (AdminPanel, sections) since they need a seeded, authenticated session.
test("anonymous visitor cannot reach the admin panel shell", async ({ page }) => {
  await page.goto("/admin").catch(() => {
    // A navigation aborted by the auth redirect is the expected gated behaviour.
  });

  await expect(page.getByRole("heading", { name: "Admin", exact: true })).toHaveCount(0);
});
