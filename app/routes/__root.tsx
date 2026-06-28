import type { QueryClient } from "@tanstack/react-query";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { fetchCurrentUser } from "~/server/auth/current-user.fn";
// Import the stylesheet as a bundled URL so the bundler emits a hashed asset
// and rewrites the href. Referencing the source path ("/app/styles/app.css")
// works in dev but 404s after `vinxi build`.
import appCss from "~/styles/app.css?url";

// The router injects the QueryClient into context (see app/router.tsx), so
// loaders can prefetch queries via `context.queryClient`.
export interface RouterContext {
  queryClient: QueryClient;
}

// Who is signed in. Prefetched in the root loader so the header renders the
// correct state on first paint (no useEffect/useState, no loading flash).
const currentUserQuery = queryOptions({
  queryKey: ["current-user"],
  queryFn: () => fetchCurrentUser(),
});

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Aubrey's List" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  loader: async ({ context }) => {
    // Prefetch on the server so the header hydrates with the right auth state.
    await context.queryClient.ensureQueryData(currentUserQuery);
  },
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: RootErrorBoundary,
});

// Primary navigation. These are placeholder destinations for the app shell —
// the routes themselves are built by later issues (browse/search, add a
// listing, about). They render as in-page links now so the nav is real and
// navigable as those routes land.
const NAV_ITEMS = [
  { to: "/", label: "Browse" },
  { to: "/", label: "Add a listing" },
  { to: "/", label: "About" },
] as const;

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <AppShell>
          <Outlet />
        </AppShell>
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

function SiteHeader() {
  return (
    <header className="border-b border-gray-200">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        {/* Brand wordmark PLACEHOLDER — the real logo/wordmark is issue #12. */}
        <Link
          to="/"
          className="text-lg font-bold tracking-tight sm:text-xl"
          aria-label="Aubrey's List home"
        >
          Aubrey's List
        </Link>

        <nav aria-label="Primary" className="order-last w-full sm:order-none sm:w-auto">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-medium text-gray-600">
            {NAV_ITEMS.map((item) => (
              <li key={item.label}>
                <Link
                  to={item.to}
                  className="hover:text-gray-900"
                  activeProps={{ className: "text-gray-900" }}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <AuthControl />
      </div>
    </header>
  );
}

// Sign-in / signed-in state. Reads the prefetched current-user query (hydrated
// from the root loader), so it renders correctly on first paint.
function AuthControl() {
  const { data: user } = useSuspenseQuery(currentUserQuery);

  if (!user) {
    // Full-page navigation to the OAuth initiation route (not an RPC data
    // fetch) — a plain anchor is the correct mechanism for the redirect dance.
    return (
      <a
        href="/api/auth/google"
        className="ml-auto rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Continue with Google
      </a>
    );
  }

  return (
    <div className="ml-auto flex items-center gap-3">
      <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-6 w-6 rounded-full" />
        ) : null}
        {user.name}
      </span>
      {/* Sign-out clears the session server-side then redirects home; a form
          POST is the right mechanism for a state-changing, full-page action. */}
      <form method="post" action="/api/auth/sign-out">
        <button
          type="submit"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold tracking-tight">404</h1>
      <p className="text-muted-foreground text-lg">Page not found.</p>
      <Link to="/" className="text-sm underline underline-offset-4">
        Go home
      </Link>
    </main>
  );
}

function RootErrorBoundary({ error, reset }: ErrorComponentProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground text-lg">
        {error instanceof Error ? error.message : "An unexpected error occurred."}
      </p>
      <div className="flex gap-4">
        <button type="button" onClick={reset} className="text-sm underline underline-offset-4">
          Try again
        </button>
        <Link to="/" className="text-sm underline underline-offset-4">
          Go home
        </Link>
      </div>
    </main>
  );
}
