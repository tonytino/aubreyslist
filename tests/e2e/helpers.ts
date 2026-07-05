import { expect, type Page } from "@playwright/test";

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
 * Wait for the BROWSE ROUTE'S OWN hydration commit (see the `data-browse-hydrated`
 * stamp in app/routes/index.tsx).
 *
 * The root `data-hydrated` marker is stamped from OUTSIDE the router's per-route
 * Suspense boundary, so it proves only that the SHELL committed — the directory
 * content inside the boundary hydrates in a LATER, lower-priority commit. In that
 * window every browse control is visible (SSR HTML) but dehydrated, and a
 * programmatic `selectOption` fired then is clobbered: the discrete `input` event
 * makes React hydrate the boundary synchronously mid-event, hydration re-syncs the
 * controlled `<select>` back to its rendered prop, and the retried `change` reports
 * the OLD value — so `?sort=`/`?radius=` never changes (the deterministic CI
 * failure behind the browse sort/radius specs; clicks survive because React
 * re-dispatches them after hydrating and they carry no DOM value to clobber).
 */
async function waitForBrowseHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.browseHydrated === "true");
}

/**
 * Wait for the browse route to be ready for control interaction.
 *
 * Two things must finish before clicking a URL-driving control on `/listings`:
 *
 *  1. Hydration of the ROUTE'S Suspense boundary, not just the shell — until the
 *     boundary's own commit lands, a `selectOption` on the sort/radius chips is
 *     clobbered by hydration's controlled-value re-sync (see
 *     {@link waitForBrowseHydration}; {@link waitForHydration} is kept first so a
 *     total no-JS regression still fails with the same signature as
 *     hydration.spec.ts).
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
  await waitForBrowseHydration(page);
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
  await waitForBrowseHydration(page);
  await expect(page.getByRole("button", { name: `Search: ${query}` })).toBeVisible();
}
