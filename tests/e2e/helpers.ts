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
 *  2. The directory's controls being interactive. The route strips default params
 *     from the URL (`stripSearchParams`), so a bare visit settles to `/` with NO
 *     query string — there is no longer a `?sort=alpha…` canonicalization to wait
 *     on (that was the old flake). We instead wait for the search chip, which only
 *     renders once the directory chrome is mounted, as the readiness signal.
 *
 * Test-only timing guard; the sort/filter features themselves are correct.
 */
export async function waitForBrowseReady(page: Page): Promise<void> {
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: "Search restaurants" })).toBeVisible();
}

/**
 * Wait for the browse route to be ready when visiting WITH a `?q=` search.
 *
 * {@link waitForBrowseReady}'s readiness signal is the idle "Search restaurants"
 * chip — which only exists when NO query is applied. With `?q=` set, the
 * SearchChip renders its APPLIED state instead: a chip-styled container whose
 * reopen button is labelled `Search: <query>` (see
 * app/components/directory/SearchChip.tsx). Waiting for that applied chip both
 * signals the directory chrome is mounted AND confirms the query round-tripped
 * from the URL into the control.
 */
export async function waitForBrowseSearchApplied(page: Page, query: string): Promise<void> {
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: `Search: ${query}` })).toBeVisible();
}
