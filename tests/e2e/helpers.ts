import { expect, type Page } from "@playwright/test";

/**
 * Wait for client hydration to actually commit before interacting.
 *
 * Waits for the `data-hydrated` attribute the root route stamps on `<html>`
 * from a post-mount effect (app/routes/__root.tsx) — effects only run after
 * React commits the hydration render, so this is a true "the page is
 * interactive" signal.
 *
 * Deliberately not `window.__TSR_ROUTER__`: the router assigns that in its
 * constructor, when the client bundle merely starts executing — in the
 * `pnpm dev` harness Playwright uses (playwright.config.ts) that can be
 * seconds before the concurrent (`startTransition`-wrapped) hydration commit,
 * because route chunks compile on demand. Interacting in that gap is
 * treacherously asymmetric: a real click is queued and replayed by React's
 * discrete-event replay, but a programmatic `change` on an SSR-rendered
 * `<select>` (Playwright's `selectOption`) is swallowed — by commit time React
 * has re-synced the controlled value and installed its input value-tracker, so
 * `onChange` never fires and the URL never updates. If hydration never happens
 * at all (the no-JS regression, hydration.spec.ts), this never resolves and
 * the test fails here — the guard is preserved.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
}

/**
 * Wait for the browse route's own hydration commit (see the
 * `data-browse-hydrated` stamp in app/routes/index.tsx).
 *
 * The root `data-hydrated` marker is stamped from outside the router's
 * per-route Suspense boundary, so it proves only that the shell committed —
 * the directory content inside the boundary hydrates in a later,
 * lower-priority commit. In that window every browse control is visible (SSR
 * HTML) but dehydrated, and a programmatic `selectOption` fired then is
 * clobbered: the discrete `input` event makes React hydrate the boundary
 * synchronously mid-event, hydration re-syncs the controlled `<select>` back
 * to its rendered prop, and the retried `change` reports the stale value — so
 * `?sort=`/`?radius=` never changes. Clicks survive because React
 * re-dispatches them after hydrating and they carry no DOM value to clobber.
 */
async function waitForBrowseHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.browseHydrated === "true");
}

/**
 * Wait for the browse route to be ready for control interaction.
 *
 * Two things must finish before clicking a URL-driving control on `/listings`:
 *
 *  1. Hydration of the route's Suspense boundary, not just the shell — until the
 *     boundary's own commit lands, a `selectOption` on the sort/radius chips is
 *     clobbered by hydration's controlled-value re-sync (see
 *     {@link waitForBrowseHydration}; {@link waitForHydration} is kept first so a
 *     total no-JS regression still fails with the same signature as
 *     hydration.spec.ts).
 *  2. The directory's controls being interactive. The route strips default params
 *     from the URL (`stripSearchParams`), so a bare visit settles to `/` with no
 *     query string. The search chip only renders once the directory chrome is
 *     mounted, so it serves as the readiness signal.
 *
 * Test-only timing guard; the sort/filter features themselves are correct.
 */
export async function waitForBrowseReady(page: Page): Promise<void> {
  await waitForHydration(page);
  await waitForBrowseHydration(page);
  await expect(page.getByRole("button", { name: "Search restaurants" })).toBeVisible();
}

/**
 * Wait for the browse route to be ready when visiting with a `?q=` search.
 *
 * {@link waitForBrowseReady}'s readiness signal is the idle "Search restaurants"
 * chip — which only exists when no query is applied. With `?q=` set, the
 * SearchChip renders its applied state instead: a chip-styled container whose
 * reopen button is labelled `Search: <query>` (see
 * app/components/directory/SearchChip.tsx). Waiting for that applied chip both
 * signals the directory chrome is mounted and confirms the query round-tripped
 * from the URL into the control.
 */
export async function waitForBrowseSearchApplied(page: Page, query: string): Promise<void> {
  await waitForHydration(page);
  await waitForBrowseHydration(page);
  await expect(page.getByRole("button", { name: `Search: ${query}` })).toBeVisible();
}
