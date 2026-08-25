import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as schema from "~/db/schema";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";
import { waitForHydration } from "./helpers";

/**
 * Attest a claim — the lazy-create entry point.
 *
 * Seed only a listing — no claim row (claims are created lazily on the first
 * vote; pre-seeding one would bypass the path under test). The "Community
 * claims" surface always renders the full fixed taxonomy as attestable, so a
 * signed-in user can begin attesting an attribute that has no claim row yet.
 * We sign in, confirm the headline `celiac_safe_vs_gluten_friendly` attribute
 * — a real `submitVote` write that creates the claim then records the
 * attestation (ADR-007) — and assert the transparent trust summary updates:
 * the per-claim roll-up shows "1 confirm / 0 dispute", the Celiac-safe badge
 * toggle reflects the viewer's own vote (`aria-pressed`), and the headline
 * summary flips from its no-confirmation guidance prose to "Celiac-safe"
 * (fresh confirm-majority → `deriveHeadlineSafetyState`). It also persists a
 * `claims` row that was never pre-seeded — proving the lazy create.
 *
 * Self-skips without the CI E2E DB / session secret (see fixtures.ts).
 */
test.describe("attest a claim — lazy-create on first vote (#150)", () => {
  let seeder: Seeder;
  let listingId: string;

  test.beforeEach(async ({ context, baseURL }) => {
    test.skip(!E2E_DB_READY, "needs CI E2E DATABASE_URL + SESSION_SECRET");
    seeder = new Seeder();

    // A bare listing with no claims — every taxonomy attribute starts un-attested
    // (the headline shows no-confirmation guidance prose, never a badge). The
    // claim is created lazily below.
    const listing = await seeder.createListing(uniqueToken("attest"));
    listingId = listing.id;

    const user = await seeder.createUser(uniqueToken("attester"));
    // biome-ignore lint/style/noNonNullAssertion: Playwright always provides baseURL from the config.
    await seeder.signIn(context, user.id, baseURL!);
  });

  test.afterEach(async () => {
    await seeder?.cleanup();
  });

  test("confirming an un-attested attribute creates the claim + updates the trust summary", async ({
    page,
  }) => {
    await page.goto(`/listings/${listingId}`);
    await waitForHydration(page);

    // Before voting: the full taxonomy renders (no "Coming soon" dead-end) and
    // the headline cue is the honest empty state. The claims live in the
    // default-open "Claims" tab panel. The tabpanel's accessible name derives
    // from its trigger's full text — the "Claims" label plus the count chip
    // (e.g. "Claims 0") — which the unanchored /Claims/ regex matches.
    const claimsSection = page.getByRole("tabpanel", { name: /Claims/ });
    // The headline row's title is "Celiac-safe". The confirm control carries
    // the same accessible name (it renders as the Celiac-safe badge), so
    // anchor the title assertion to the row-title paragraph — a bare getByText
    // would match both and trip strict mode.
    await expect(claimsSection.locator("p", { hasText: /^Celiac-safe$/ })).toBeVisible();
    const safety = page.getByRole("region", { name: "Gluten-free safety" });
    await expect(safety.getByTestId("safety-summary-guidance")).toContainText(
      "This restaurant isn't confirmed celiac-safe."
    );

    // Confirm the headline attribute via its badge toggle — the confirm
    // control is the Celiac-safe badge (there is no generic "Confirm" button).
    // It is rendered for a signed-in viewer even though no claim row exists
    // yet — the write creates it.
    const confirm = claimsSection.getByRole("button", { name: "Celiac-safe" });
    await expect(confirm).toBeVisible();
    await confirm.click();

    // The viewer's own vote is now reflected on the control…
    await expect(confirm).toHaveAttribute("aria-pressed", "true");
    // …the per-claim roll-up shows the visible confirm/dispute distribution…
    await expect(page.getByText("1 confirm / 0 dispute")).toBeVisible();
    // …and the headline summary flips to celiac-safe (fresh confirm-majority).
    await expect(safety.getByText("Celiac-safe")).toBeVisible();

    // The lazy create persisted a real `claims` row that was never pre-seeded.
    const created = await seeder.db
      .select()
      .from(schema.claims)
      .where(
        and(
          eq(schema.claims.listingId, listingId),
          eq(schema.claims.attribute, "celiac_safe_vs_gluten_friendly")
        )
      );
    expect(created).toHaveLength(1);
  });
});
