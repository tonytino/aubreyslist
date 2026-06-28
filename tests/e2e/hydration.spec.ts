import { expect, test } from "@playwright/test";

/**
 * Regression guard for app hydration (the "no-JS site" bug).
 *
 * The app SSRs fine but only becomes interactive if the served HTML references
 * the built client entry — a `<script type="module">` that import()s
 * `/_build/assets/client-*.js`, which runs app/client.tsx's hydrateRoot. That
 * script is emitted by `<Scripts/>` (app/routes/__root.tsx) from the router
 * manifest, which is only populated when `getRouterManifest` is passed to
 * `createStartHandler` in app/ssr.tsx. When that wiring is dropped, the manifest
 * is empty (`{"$undefined":0}` in the dehydrated payload), no client script is
 * injected, and NOTHING hydrates: voting, the add-listing form, the taxonomy
 * filter, sort, and SPA <Link> navigation are all inert (a no-JS site).
 *
 * This spec proves two things end to end, with no database required:
 *   1. the served HTML actually references a client `*.js` module entry, and
 *   2. the app hydrates — a <Link> performs client-side (SPA) navigation rather
 *      than a full document load.
 */

test("served HTML references the client module entry", async ({ request }) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  const html = await res.text();

  // A real client-entry script: `<script type="module">` whose body import()s a
  // hashed client bundle under /_build/assets/. Without this the app is no-JS.
  expect(html).toMatch(/<script[^>]*type="module"/);
  expect(html).toMatch(/import\(["'][^"']*\/_build\/assets\/client-[^"']*\.js["']\)/);

  // The dehydrated router manifest must carry the root route's assets, not the
  // empty `{"$undefined":0}` that signals a missing manifest.
  expect(html).not.toContain('"manifest":{"$undefined":0}');
});

test("the app hydrates: a <Link> does client-side navigation, not a full reload", async ({
  page,
}) => {
  await page.goto("/");

  // Plant a sentinel on the live JS context. A real SPA navigation preserves the
  // document (and this variable); a full page load (the un-hydrated fallback,
  // where the <Link> behaves as a plain <a>) wipes it.
  await page.evaluate(() => {
    (window as unknown as { __hydrationSentinel?: boolean }).__hydrationSentinel = true;
  });

  // The home hero links to the add-listing route via TanStack Router's <Link>.
  // Client-side navigation only happens once hydrateRoot has run.
  await page.getByRole("link", { name: "Add a listing", exact: false }).first().click();

  await expect(page).toHaveURL(/\/listings\/new/);

  // If the sentinel survived, the navigation was client-side — proof the page
  // hydrated and the router took over routing.
  const survived = await page.evaluate(
    () => (window as unknown as { __hydrationSentinel?: boolean }).__hydrationSentinel === true
  );
  expect(survived).toBe(true);
});
