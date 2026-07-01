import { expect, test } from "@playwright/test";

import { waitForHydration } from "./helpers";

/**
 * Regression guard for app hydration (the "no-JS site" bug).
 *
 * The app SSRs fine but only becomes interactive if the served HTML references
 * the built client entry — a `<script type="module">` whose `src` loads the
 * client bundle, which runs app/client.tsx's hydrateRoot (which in turn imports
 * `getRouter` from app/router.tsx). Since the TanStack Start vinxi→Vite-plugin
 * migration (issue #198) the entry is wired automatically by the plugin; if that
 * wiring breaks (e.g. app/router.tsx stops exporting `getRouter`, or the client
 * entry is dropped), no client script is injected and NOTHING hydrates: voting,
 * the add-listing form, the taxonomy filter, sort, and SPA <Link> navigation are
 * all inert (a no-JS site).
 *
 * These tests run against the SAME harness CI uses (`pnpm dev`, per
 * playwright.config.ts), and are written to also be correct against the prod
 * build. The client-entry `src` differs by mode: dev injects the virtual module
 * `/@id/virtual:tanstack-start-dev-client-entry`, prod injects the hashed
 * `/assets/index-*.js` bundle — the assertion accepts both and then fetches the
 * referenced src to prove the entry asset actually resolves.
 */

// The module-script entry src: prod hashed bundle OR the dev virtual entry id.
const CLIENT_ENTRY_SRC =
  /<script[^>]*type="module"[^>]*\ssrc="([^"]*(?:\/assets\/index-[^"]*\.js|virtual:tanstack-start-dev-client-entry)[^"]*)"/;

test("served HTML injects the client module entry", async ({ request }) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  const html = await res.text();

  // A real client-entry script: `<script type="module">` whose `src` loads the
  // client bundle (hashed /assets/index-*.js in prod, the virtual entry id in
  // dev). Without this the app is no-JS.
  expect(html).toMatch(/<script[^>]*type="module"/);
  const src = html.match(CLIENT_ENTRY_SRC)?.[1];
  expect(src, "no client module entry <script src> found in served HTML").toBeTruthy();

  // The referenced entry asset must actually resolve — a broken asset path would
  // mean the browser never loads the client bundle and the app never hydrates.
  const entryRes = await request.get(src as string);
  expect(entryRes.status(), `client entry ${src} did not resolve`).toBe(200);
});

test("the app hydrates: a <Link> does client-side navigation, not a full reload", async ({
  page,
}) => {
  await page.goto("/");

  // Wait for hydration to actually complete before interacting. TanStack Router
  // assigns `window.__TSR_ROUTER__` in its constructor, which only runs when the
  // client bundle executes (i.e. hydrateRoot ran). In dev the bundle is compiled
  // and fetched on demand, so this can take a moment after first paint — clicking
  // before it resolves would hit a not-yet-hydrated <Link> (a dead <a>) and read
  // as a full reload. If hydration never happens (the bug), this never resolves
  // and the test fails here, which is the regression we guard.
  await waitForHydration(page);

  // Plant a sentinel on the live JS context. A real SPA navigation preserves the
  // document (and this variable); a full page load wipes it.
  await page.evaluate(() => {
    (window as unknown as { __hydrationSentinel?: boolean }).__hydrationSentinel = true;
  });

  // The home hero links to the add-listing route via TanStack Router's <Link>.
  // Client-side navigation only happens once the page has hydrated.
  await page.getByRole("link", { name: "Add a listing", exact: false }).first().click();
  await expect(page).toHaveURL(/\/listings\/new/);

  // If the sentinel survived, the navigation was client-side — proof the page
  // hydrated and the router took over routing instead of doing a full document load.
  const survived = await page.evaluate(
    () => (window as unknown as { __hydrationSentinel?: boolean }).__hydrationSentinel === true
  );
  expect(survived).toBe(true);
});
