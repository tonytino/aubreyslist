import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { E2E_DB_READY, Seeder, uniqueToken } from "./fixtures";
import { waitForBrowseReady } from "./helpers";

/**
 * Directory Map view (`?view=map`) — DB-gated accessibility + keyboard pass
 * (AUB-278).
 *
 * Lives in its own file, deliberately NOT `a11y.spec.ts`, for two reasons:
 *
 * 1. **It needs a real database.** `/` (the directory) needs a live
 *    `DATABASE_URL` to render its real content at all — DB-free it hits the
 *    router's default error component instead (see `a11y.spec.ts`'s
 *    "Deliberately excluded" note) — and even with a DB the map's content
 *    area only mounts once `vms.length > 0` (`app/routes/index.tsx`). So this
 *    file seeds its own listing and self-skips without the CI E2E
 *    database/session secret, exactly like every other DB-touching spec
 *    (`tests/e2e/fixtures.ts` → `E2E_DB_READY`; mirrors
 *    `browse-filter-results.spec.ts`).
 * 2. **Filename routing.** `playwright.config.ts` runs `a11y.spec.ts` ONLY
 *    under the dedicated `a11y` Playwright project, and that project is
 *    exactly what the always-on, DB-free `.github/workflows/a11y.yml` lane
 *    invokes (`--project=a11y`, deliberately setting no `DATABASE_URL`) — the
 *    `chromium` project's `testIgnore: /a11y\.spec\.ts/` excludes it from the
 *    DB-backed `integration-e2e` lane (`ci.yml`, `pnpm test:e2e
 *    --project=chromium`) entirely. Both of those config regexes match on
 *    unanchored substring, so ANY filename ending in literal "a11y.spec.ts" —
 *    including an at-first-glance-reasonable `map-a11y.spec.ts` — collides
 *    with them too and would be silently DB-free-only forever, the same dead
 *    end this file exists to avoid (verified with
 *    `node -e "/a11y\.spec\.ts/.test('tests/e2e/map-a11y.spec.ts')"` → `true`,
 *    vs. `map-accessibility.spec.ts` → `false`). Hence the deliberately
 *    non-colliding name here. This file therefore runs under
 *    `--project=chromium` (the DB-backed lane, where `E2E_DB_READY` can
 *    actually be true) and is correctly absent from `--project=a11y`.
 *    Nothing in `.github/` or `playwright.config.ts` needed to change.
 *
 * These DB-gated scans complement, not replace, `a11y.spec.ts`'s always-on
 * DB-free lane: that lane gates every PR unconditionally on the public static
 * pages; this file adds real, seeded-data coverage of the one surface that
 * lane structurally cannot reach, but only where the optional CI E2E DB
 * secret is configured.
 *
 * Render path: this environment provisions no
 * `VITE_GOOGLE_MAPS_BROWSER_KEY` (local dev / CI / E2E — see the key check in
 * `DirectoryMap.tsx`), so `?view=map` renders the CSS-placeholder fallback
 * (`DirectoryMap.tsx`'s `PlaceholderMap`), not the real Google
 * `<AdvancedMarker>` map (`DirectoryMapLive.tsx`). Both paths render the
 * exact same pin `<button>` and mini-card carousel from the shared
 * `map-ui.tsx` (`MapPinButton`, `MapCarousel`) — only the backdrop (CSS blobs
 * vs. Google tiles) and the pin's positioning mechanism (percent-projected
 * vs. a real marker at true lat/lng) differ — so this spec's coverage (the
 * axe scan and the pin/carousel keyboard flow) exercises that shared,
 * accessible surface unchanged either way. If a future environment
 * provisions the live browser key for E2E, this spec starts exercising the
 * real `<AdvancedMarker>` DOM with no changes needed here.
 *
 * A single seeded listing is enough for every test below. Its name gets a
 * leading-digit prefix so it sorts first under the directory's default
 * alphabetical order (mirrors `browse-filter-results.spec.ts`), making it
 * deterministically `entries[0]` — pin/mini-card index 1, and the FIRST pin
 * in tab order — regardless of how much other data the persistent CI Neon
 * branch has accrued. It gets no claims, so it renders the neutral
 * no-verdict pin (`UNATTESTED_PIN` in `map-ui.tsx`) with an accessible name
 * equal to exactly its listing name (no safety label, no incident chip) —
 * which is also what makes it possible to target the pin unambiguously with
 * an exact accessible-name match below.
 *
 * Themes: the app has no theme query param — a visitor's choice lives in
 * `localStorage.theme`, read by the no-FOUC inline script in
 * `app/routes/__root.tsx` before hydration (see `ThemeToggle.tsx`'s
 * `readAppliedTheme`/`toggle`). Setting it via `page.addInitScript` before
 * `goto` reproduces exactly what that script does, so both scans below see
 * the real pre-paint theme rather than racing a post-mount toggle click.
 *
 * Rule set: `wcag2a` + `wcag2aa` — the same deterministic tag set
 * `a11y.spec.ts` uses, for the same reason (stable across axe releases).
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa"] as const;

/** Run axe on the current page and return a readable summary of any violations. */
async function analyze(page: Page) {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(" ")),
  }));
  return { violations: results.violations, summary };
}

/**
 * Press Tab repeatedly (bounded) until `target` actually receives DOM focus,
 * or throw. This proves an element is reachable via the browser's own
 * sequential keyboard navigation — not merely that `locator.focus()` can
 * force focus onto it programmatically — which is exactly what's under test
 * for the map view's pin/carousel keyboard flow below. Bounded rather than
 * unbounded so a regression that removes the target from the tab order fails
 * fast with a clear error instead of hanging.
 */
async function tabUntilFocused(page: Page, target: Locator, maxPresses: number): Promise<void> {
  for (let i = 0; i < maxPresses; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) {
      return;
    }
  }
  throw new Error(`Tab did not reach the target element within ${maxPresses} presses`);
}

test.describe("directory map view (?view=map, DB-gated)", () => {
  let seeder: Seeder;
  let listingName: string;

  test.beforeEach(async () => {
    test.skip(!E2E_DB_READY, "needs CI E2E DATABASE_URL + SESSION_SECRET");
    seeder = new Seeder();
    const token = uniqueToken("map-a11y");
    const listing = await seeder.createListing(token, { name: `0000-${token} Diner` });
    listingName = listing.name;
  });

  test.afterEach(async () => {
    await seeder?.cleanup();
  });

  const MAP_THEMES = ["light", "dark"] as const;

  for (const theme of MAP_THEMES) {
    test(`a11y: ?view=map has no WCAG 2 A/AA violations (${theme} theme)`, async ({ page }) => {
      if (theme === "dark") {
        await page.addInitScript(() => localStorage.setItem("theme", "dark"));
      }
      await page.goto("/?view=map");
      await waitForBrowseReady(page);
      // The pin/carousel render only once the map content area mounts and the
      // seeded listing lands — wait for the pin so axe scans the real pin +
      // carousel DOM, not a still-loading content area.
      await expect(page.getByRole("button", { name: listingName, exact: true })).toBeVisible();

      const { violations, summary } = await analyze(page);
      if (violations.length > 0) {
        console.error(
          `axe violations on /?view=map (${theme} theme):\n${JSON.stringify(summary, null, 2)}`
        );
      }
      expect(
        violations,
        `axe found ${violations.length} WCAG 2 A/AA violation(s) on /?view=map (${theme} theme) — see console output above`
      ).toEqual([]);
    });
  }

  /**
   * Live-path keyboard operability: a pin must be reachable by Tab (not just
   * clickable), Enter must select it (`aria-pressed`, never colour alone),
   * that selection must sync to the matching mini-card in the carousel, and
   * Tab order must then proceed through the selected mini-card's three
   * stops in order — the card button, the favourite button, then the
   * chevron link — never nested (`MapCarousel`'s doc in `map-ui.tsx`).
   */
  test("keyboard: Tab reaches a pin button, Enter selects it, and the carousel stays in sync", async ({
    page,
  }) => {
    await page.goto("/?view=map");
    await waitForBrowseReady(page);

    const pin = page.getByRole("button", { name: listingName, exact: true });
    await expect(pin).toBeVisible();

    // The carousel scopes the mini-card locators below to its own subtree.
    // The seeded listing sorts first (see the describe doc), so its
    // mini-card is the carousel's first entry wrapper — each entry wrapper
    // renders, in DOM order, the card button, the favourite button, then the
    // chevron link (map-ui.tsx's `MapCarousel`).
    const carousel = page.getByTestId("map-carousel");
    const firstCard = carousel.locator("> div").first();
    const cardButton = firstCard.getByRole("button").first();
    const favoriteButton = firstCard.getByRole("button").nth(1);
    const chevronLink = firstCard.getByRole("link");

    // Tab from a blank focus (nothing is focused on a fresh load) until the
    // seeded pin — the first pin in DOM order — actually receives focus.
    // Bounded generously: the directory's header + filter chrome (search,
    // quick/taxonomy chips, sort, distance, ViewToggle, …) all precede the
    // map content area, but our pin is entries[0] so no other pin can be
    // ahead of it.
    await tabUntilFocused(page, pin, 80);
    await expect(pin).toBeFocused();

    // Enter activates the pin like any real <button>.
    await page.keyboard.press("Enter");
    await expect(pin).toHaveAttribute("aria-pressed", "true");

    // Carousel sync: activating a pin must select its matching mini-card too
    // (the shared `useUserSelectionChange` discriminator in `map-ui.tsx`).
    await expect(cardButton).toHaveAttribute("aria-pressed", "true");

    // Continue the SAME tab sequence (focus is still on the pin — a keypress
    // doesn't move it) through to the mini-card's three stops, confirming
    // both the order and that each is individually reachable.
    await tabUntilFocused(page, cardButton, 60);
    await expect(cardButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(favoriteButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(chevronLink).toBeFocused();
  });

  /**
   * The pin is a real <button>, so Space must activate it exactly like Enter
   * does above. Scoped narrowly (a direct `.focus()`, not a re-walk of the
   * full tab order already proven above) since the only thing left to prove
   * here is that the OTHER native activation key fires the same handler.
   */
  test("keyboard: Space also activates the pin button", async ({ page }) => {
    await page.goto("/?view=map");
    await waitForBrowseReady(page);

    const pin = page.getByRole("button", { name: listingName, exact: true });
    await expect(pin).toBeVisible();
    await pin.focus();
    await page.keyboard.press("Space");
    await expect(pin).toHaveAttribute("aria-pressed", "true");
  });
});
