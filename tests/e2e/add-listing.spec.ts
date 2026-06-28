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
  await expect(page.getByText("Please sign in to add a restaurant.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
});
