import { type Page, expect } from "@playwright/test";

/**
 * Wait for client hydration to actually complete before interacting.
 *
 * TanStack Router assigns `window.__TSR_ROUTER__` in its constructor, which only
 * runs when the client bundle executes (i.e. `hydrateRoot` ran). In the `pnpm dev`
 * harness Playwright uses (see playwright.config.ts), the client bundle is compiled
 * and fetched on demand, so this can take a moment after first paint — interacting
 * with a control before it resolves would hit a not-yet-hydrated element (e.g. a
 * <select> or checkbox whose onChange isn't wired yet) and the URL would never
 * update. Awaiting this condition makes control interactions deterministic.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as unknown as { __TSR_ROUTER__?: unknown }).__TSR_ROUTER__ !== "undefined"
  );
}

/**
 * Wait for the browse route to be ready for control interaction.
 *
 * Two things must finish before clicking a URL-driving control on `/listings`:
 *
 *  1. Hydration — until the client bundle runs the controls' onChange handlers
 *     aren't wired (see {@link waitForHydration}).
 *  2. The route's initial search-param canonicalization. On hydration the browse
 *     route normalizes its URL to the full, validated search shape
 *     (`?page=1&attrs=&sort=alpha`) via a `navigate`. That navigation lands a beat
 *     AFTER hydration; a `selectOption`/`check` fired in that window is clobbered
 *     by the in-flight canonicalization (the URL snaps back to the default
 *     `sort=alpha`), which is the flake. Waiting for the canonical `sort=` param to
 *     appear proves that navigation settled, so the next interaction sticks.
 *
 * Test-only timing guard; the sort/filter features themselves are correct.
 */
export async function waitForBrowseReady(page: Page): Promise<void> {
  await waitForHydration(page);
  await expect(page).toHaveURL(/sort=/);
}

/**
 * Open the directory's "Filters" bottom sheet, where the AUB-61 redesign hosts
 * the server-side sort control + taxonomy filter (the mobile header surfaces the
 * search + quick chips instead). Waits for the route to be ready first so the
 * chip's handler is wired, then opens the sheet and waits for its dialog.
 */
export async function openBrowseFilters(page: Page): Promise<void> {
  await waitForBrowseReady(page);
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
