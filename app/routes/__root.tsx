import * as Sentry from "@sentry/tanstackstart-react";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import type { ErrorComponentProps } from "@tanstack/react-router";
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { useEffect } from "react";
import { currentUserQuery } from "~/auth/current-user-query";
import { previewLoginEnabledQuery } from "~/auth/preview-login-query";
import { SiteFooter } from "~/components/SiteFooter";
import { SiteHeader } from "~/components/SiteHeader";
import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/sonner";
import { favoriteIdsQuery } from "~/favorites/favorites-query";
import { PendingFavoriteHandler } from "~/favorites/use-pending-favorite";
import { isProductionEnvironmentQuery } from "~/lib/deployment-env-query";
import { defaultSeoMeta, jsonLdScript, siteJsonLd } from "~/lib/seo";
// Import the stylesheet as a bundled URL so the bundler emits a hashed asset
// and rewrites the href. Referencing the source path works in dev but 404s in
// production builds.
import appCss from "~/styles/app.css?url";

// The router injects the QueryClient into context (see app/router.tsx), so
// loaders can prefetch queries via `context.queryClient`.
export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: defaultSeoMeta(),
    links: [
      // Preconnect to the Google Fonts hosts so the font CSS + files start
      // fetching early (the second uses crossOrigin because fonts are fetched
      // anonymously).
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      // Bricolage Grotesque (display/headings) + Public Sans (body/UI), loaded
      // with display=swap so text paints immediately in the fallback and swaps
      // to the webfont on load (no invisible-text FOIT).
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Public+Sans:ital,wght@0,300..800;1,300..800&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      // Raster fallback at a multiple of 48px: Google Search's favicon
      // crawler wants a >=48x48 icon and is unreliable with SVG-only —
      // without this it shows the generic globe next to results.
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
    // Site-level structured data (WebSite + Organization), injected once at
    // the root. Serialized via `jsonLdScript`, which escapes `<` so a value
    // can't break out of the tag.
    scripts: [jsonLdScript(siteJsonLd())],
  }),
  loader: async ({ context }) => {
    // Prefetch on the server so the header hydrates with the right auth state
    // and favorite controls hydrate marked without a client round-trip
    // (anonymous viewers short-circuit to `[]`, no DB hit).
    await Promise.all([
      context.queryClient.ensureQueryData(currentUserQuery),
      context.queryClient.ensureQueryData(favoriteIdsQuery),
      // Whether to show the preview-only "Dev sign-in" affordance in the
      // header (resolves false in production, so nothing renders there).
      context.queryClient.ensureQueryData(previewLoginEnabledQuery),
      // Whether this deployment is real production, per `VERCEL_ENV` — the
      // root error boundary needs this to decide raw-vs-sanitized error copy
      // (see app/lib/deployment-env-query.ts).
      context.queryClient.ensureQueryData(isProductionEnvironmentQuery),
    ]);
  },
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: RootErrorBoundary,
});

function RootComponent() {
  // Post-hydration marker. `useEffect` runs only after React commits the
  // hydration render, so this stamp is the earliest honest "the page is
  // interactive" signal — `window.__TSR_ROUTER__` is assigned in the router
  // constructor, long before the hydration commit. In that gap a real click
  // is replayed by React's discrete-event replay, but a programmatic `change`
  // on an SSR-rendered `<select>` (Playwright `selectOption`) is swallowed:
  // by commit time React has re-synced the controlled value, so the
  // pre-commit change never reaches `onChange`. The E2E `waitForHydration`
  // helper waits for this attribute. Idempotent under StrictMode; never
  // removed (the document outlives SPA navigations, and a full reload
  // re-stamps it).
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);

  return (
    <html lang="en">
      <head>
        {/* No-FOUC theme script — the single sanctioned use of
            dangerouslySetInnerHTML in the app. The render-blocking IIFE must
            run before first paint to set the `dark` class on <html>, or
            dark-preference users see a light flash during hydration. It reads
            localStorage.theme, falls back to `prefers-color-scheme`, and is
            wrapped in try/catch so blocked storage can never break the page. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: render-blocking no-FOUC theme init must run before hydration; see comment above.
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();",
          }}
        />
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AppShell>
          <Outlet />
        </AppShell>
        {/* Headless: auto-saves a pending `?save=<id>` favorite after
            sign-in. Runs inside the router + query providers. */}
        <PendingFavoriteHandler />
        <Toaster />
        <Scripts />
        <Analytics />
      </body>
    </html>
  );
}

// Exported for direct component testing: RootComponent renders a full <html>
// document, which RTL can't mount into a container element, so tests exercise
// AppShell in isolation.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Skip link: must stay the first focusable element, before SiteHeader.
          Visually hidden until keyboard focus (`sr-only focus:not-sr-only`),
          then jumps past the repeated nav to <main>. tabIndex={-1} on <main>
          makes it programmatically focusable via the anchor jump without
          joining the normal Tab order. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-chip focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
      >
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-gutter text-center">
      <h1 className="text-display font-bold tracking-tight">404</h1>
      <p className="text-lead text-muted-foreground">Page not found.</p>
      <Button asChild>
        <Link to="/">Go home</Link>
      </Button>
    </main>
  );
}

// Shown instead of the raw error message in production, where `error.message`
// can leak internals to end users. The real error is still captured by Sentry
// below — sanitizing the on-screen copy loses no diagnostic signal.
const GENERIC_ERROR_MESSAGE = "An unexpected error occurred. Our team has been notified.";

/**
 * Computes the RootErrorBoundary's user-facing message. The boundary is a
 * client component, so `isProduction` must come from the server-truth
 * `VERCEL_ENV` signal (`isProductionEnvironmentQuery`) — never
 * `import.meta.env.PROD`, which is also true on Vercel preview deployments
 * and would wrongly sanitize errors there. Exported so both branches get
 * direct unit coverage without faking the query through a component render.
 */
export function rootErrorBoundaryMessage(error: unknown, isProduction: boolean): string {
  if (isProduction) {
    return GENERIC_ERROR_MESSAGE;
  }
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

export function RootErrorBoundary({ error, reset }: ErrorComponentProps) {
  // Errors handled by an errorComponent are not auto-reported, so forward
  // them to Sentry explicitly.
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  // Non-suspending: an error boundary must never itself suspend. In the
  // common case (a child route threw, not the root loader) the root loader
  // already prefetched this, so `data` is available on first render. Fails
  // closed to `true` (sanitized) — matching `isProductionEnvironment`'s own
  // fail-closed default — if the root loader never got to prefetch it.
  const { data: isProduction = true } = useQuery(isProductionEnvironmentQuery);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-gutter text-center">
      <h1 className="text-headline font-bold tracking-tight">Something went wrong</h1>
      <p className="text-lead text-muted-foreground">
        {rootErrorBoundaryMessage(error, isProduction)}
      </p>
      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={reset}>
          Try again
        </Button>
        <Button asChild>
          <Link to="/">Go home</Link>
        </Button>
      </div>
    </main>
  );
}
