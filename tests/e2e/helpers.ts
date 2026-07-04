import { type Page, expect } from "@playwright/test";

/**
 * Wait for client hydration to actually COMMIT before interacting.
 *
 * Waits for the `data-hydrated` attribute the root route stamps on `<html>`
 * from a post-mount effect (app/routes/__root.tsx) — effects only run after
 * React commits the hydration render, so this is a true "the page is
 * interactive" signal.
 *
 * Deliberately NOT `window.__TSR_ROUTER__` (the old signal): the router
 * assigns that in its CONSTRUCTOR, when the client bundle merely starts
 * executing — in the `pnpm dev` harness Playwright uses (playwright.config.ts)
 * that can be seconds before the concurrent (`startTransition`-wrapped)
 * hydration commit, because route chunks compile on demand. Interacting in
 * that gap is treacherously asymmetric: a real CLICK is queued and replayed by
 * React's discrete-event replay (so chip clicks "worked"), but a programmatic
 * `change` on an SSR-rendered `<select>` (Playwright's `selectOption`) is
 * swallowed — by commit time React has re-synced the controlled value and
 * installed its input value-tracker, so `onChange` never fires and the URL
 * never updates. That was the deterministic CI failure behind the browse
 * sort-chip specs (sort select as the FIRST interaction on a fresh load
 * failed every retry, while the same select after any prior navigation
 * passed). If hydration never happens at all (the no-JS regression,
 * hydration.spec.ts), this never resolves and the test fails here — the guard
 * is preserved.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
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
