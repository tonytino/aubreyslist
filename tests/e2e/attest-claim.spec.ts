import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as schema from "~/db/schema";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";
import { waitForHydration } from "./helpers";

/**
 * Attest a claim — the lazy-create entry point (issues #45, #150).
 *
 * Seed ONLY a listing — NO claim row (the whole point of #150 is that claims
 * are created lazily on the first vote; pre-seeding one would bypass the path
 * under test). The "Community claims" surface now ALWAYS renders the full fixed
 * taxonomy as attestable, so a signed-in user can begin attesting an attribute
 * that has no claim row yet. We sign in, CONFIRM the headline
 * `celiac_safe_vs_gluten_friendly` attribute — a real `submitVote` write that
 * CREATES the claim then records the attestation (ADR-007) — and assert the
 * transparent trust summary updates: the per-claim roll-up shows
 * "1 confirm / 0 dispute", the Confirm control reflects the viewer's own vote
 * (`aria-pressed`), and the headline summary flips from the honest
 * "Not yet attested" empty state to "Celiac-safe" (fresh confirm-majority →
 * `deriveHeadlineSafetyState`). It also persists a `claims` row that was never
 * pre-seeded — proving the lazy create.
 *
 * Self-skips without the CI E2E DB / session secret (see fixtures.ts).
 */
test.describe("attest a claim — lazy-create on first vote (#150)", () => {
  let seeder: Seeder;
  let listingId: string;

  test.beforeEach(async ({ context, baseURL }) => {
    test.skip(!E2E_DB_READY, "needs CI E2E DATABASE_URL + SESSION_SECRET");
    seeder = new Seeder();

    // A bare listing with NO claims — every taxonomy attribute starts un-attested
    // (the headline reads "Not yet attested"). The claim is created lazily below.
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
    // the headline cue is the honest empty state.
    const claimsSection = page.getByRole("region", { name: "Community claims" });
    // Exact match: the row label is "Celiac-safe" (issue #175); the row's
    // confirm/dispute clarifier copy also contains "celiac-safe" lower-cased.
    await expect(claimsSection.getByText("Celiac-safe", { exact: true })).toBeVisible();
    const safety = page.getByRole("region", { name: "Gluten-free safety" });
    await expect(safety.getByText("Not yet attested")).toBeVisible();

    // Confirm the headline attribute. The control is rendered for a signed-in
    // viewer even though NO claim row exists yet — the write creates it.
    const confirm = page.getByRole("button", { name: "Confirm" }).first();
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
