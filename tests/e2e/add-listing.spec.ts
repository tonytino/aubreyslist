import { expect, test } from "@playwright/test";

// Smoke test for the add-listing route (issue #26). Runs anonymous — adding a
// listing is a gated write (ADR-010), so an unauthenticated visitor sees the
// sign-in prompt rather than an intake form. This needs no seeded data and
// writes nothing, so it is safe against the persistent CI Neon branch (see
// docs/agents/testing.md). Exercising the authenticated places/manual forms
// requires a real Google OAuth session and is out of scope for a smoke test.
test("add-listing page prompts anonymous visitors to sign in", async ({ page }) => {
  await page.goto("/listings/new");

  await expect(page.getByRole("heading", { name: "Add a restaurant" })).toBeVisible();

  // Scope to the page's sign-in prompt region: the app-shell header also renders
  // a "Continue with Google" link, so an unscoped page locator matches 2 elements
  // and trips Playwright strict mode. The labeled region (a <section aria-label>
  // in the route component) disambiguates to the link this route renders.
  const prompt = page.getByRole("region", { name: "Sign in to add a restaurant" });
  await expect(prompt.getByText("Please sign in to add a restaurant.")).toBeVisible();
  await expect(prompt.getByRole("link", { name: "Continue with Google" })).toBeVisible();
});
