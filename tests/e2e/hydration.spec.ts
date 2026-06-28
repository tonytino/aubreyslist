import { expect, test } from "@playwright/test";

/**
 * Regression guard for app hydration (the "no-JS site" bug).
 *
 * The app SSRs fine but only becomes interactive if the served HTML references
 * the built client entry — a `<script type="module">` that import()s the client
 * bundle, which runs app/client.tsx's hydrateRoot. That script is emitted by
 * `<Scripts/>` (app/routes/__root.tsx) from the router manifest, which is only
 * populated when `getRouterManifest` is passed to `createStartHandler` in
 * app/ssr.tsx. When that wiring is dropped, the manifest is empty (the dehydrated
 * payload's top-level manifest serializes to `{"$undefined":0}`), no client
 * script is injected, and NOTHING hydrates: voting, the add-listing form, the
 * taxonomy filter, sort, and SPA <Link> navigation are all inert (a no-JS site).
 *
 * These tests run against the SAME harness CI uses (`pnpm dev`, per
 * playwright.config.ts), and are written to also be correct against the prod
 * build. The client-entry path differs by mode: dev injects an unhashed
 * `import("/_build/@fs/.../app/client.tsx")`, prod injects the hashed
 * `import("/_build/assets/client-*.js")` — the assertions accept both.
 */

// The module-script entry import target: prod hashed bundle OR the dev @fs path.
const CLIENT_ENTRY_IMPORT =
  /import\(["'][^"']*(?:\/_build\/assets\/client-[^"']*\.js|\/app\/client\.tsx)["']\)/;

test("served HTML injects the client module entry", async ({ request }) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  const html = await res.text();

  // A real client-entry script: `<script type="module">` whose body import()s the
  // client bundle (hashed in prod, the @fs source path in dev). Without this the
  // app is no-JS.
  expect(html).toMatch(/<script[^>]*type="module"/);
  expect(html).toMatch(CLIENT_ENTRY_IMPORT);

  // The dehydrated router manifest must actually carry the root route's assets.
  // The bug serialized the whole manifest as `{"$undefined":0}` (no `routes`);
  // a working manifest has `manifest":{"routes":{"__root__":{...}`. Asserting the
  // populated shape is meaningful in both dev and prod (unlike the literal
  // `{"$undefined":0}`, which never serializes once the manifest is wired).
  expect(html).toMatch(/manifest\\?":\{\\?"routes\\?":\{\\?"__root__\\?":/);
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
  await page.waitForFunction(
    () => typeof (window as unknown as { __TSR_ROUTER__?: unknown }).__TSR_ROUTER__ !== "undefined"
  );

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
