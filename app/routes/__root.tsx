import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { currentUserQuery } from "~/auth/current-user-query";
import { SiteHeader } from "~/components/SiteHeader";
import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/sonner";
// Import the stylesheet as a bundled URL so the bundler emits a hashed asset
// and rewrites the href. Referencing the source path ("/app/styles/app.css")
// works in dev but 404s after `vinxi build`.
import appCss from "~/styles/app.css?url";

// The router injects the QueryClient into context (see app/router.tsx), so
// loaders can prefetch queries via `context.queryClient`.
export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Aubrey's List" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  }),
  loader: async ({ context }) => {
    // Prefetch on the server so the header hydrates with the right auth state.
    await context.queryClient.ensureQueryData(currentUserQuery);
  },
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: RootErrorBoundary,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        {/* No-FOUC theme script. This is the single sanctioned use of
            dangerouslySetInnerHTML in the app: a tiny, dependency-free,
            render-blocking IIFE must run BEFORE first paint to set the `dark`
            class on <html>, otherwise dark-preference users see a light flash
            during hydration. It reads localStorage.theme, falling back to the
            OS `prefers-color-scheme` media query, and is wrapped in try/catch
            so a blocked storage access can never break the page. */}
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
        <Toaster />
        <Scripts />
        <Analytics />
      </body>
    </html>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
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

function RootErrorBoundary({ error, reset }: ErrorComponentProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-gutter text-center">
      <h1 className="text-headline font-bold tracking-tight">Something went wrong</h1>
      <p className="text-lead text-muted-foreground">
        {error instanceof Error ? error.message : "An unexpected error occurred."}
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
