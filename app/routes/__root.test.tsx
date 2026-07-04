import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { currentUserQuery } from "~/auth/current-user-query";
import { previewLoginEnabledQuery } from "~/auth/preview-login-query";
import { isProductionEnvironmentQuery } from "~/lib/deployment-env-query";

/**
 * Component tests for `app/routes/__root.tsx`:
 *
 * - AUB-166: the skip-to-content link (rendered by `AppShell`) is present,
 *   first-focusable, and targets `<main>`.
 * - AUB-142: `SiteFooter` is mounted inside `AppShell` on every route.
 * - AUB-170: `RootErrorBoundary` renders the sanitized generic copy in
 *   production and keeps the raw `error.message` outside production — driven
 *   by `isProductionEnvironmentQuery` (server-truth `VERCEL_ENV`, NOT
 *   `import.meta.env.PROD`, which can't distinguish a Vercel preview
 *   deployment from real production) — and `rootErrorBoundaryMessage` (the
 *   pure helper) is covered directly for both branches.
 *
 * `RootComponent` itself renders a full `<html>`/`<body>` document (framework
 * requirement), which RTL can't mount into a container element — so these
 * tests exercise the exported `AppShell` and `RootErrorBoundary` pieces
 * directly, same rationale as `SiteHeader.test.tsx` testing `SiteHeader` in
 * isolation rather than the whole route tree.
 */
const h = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  fetchIsProductionEnvironmentMock: vi.fn(),
}));

vi.mock("@sentry/tanstackstart-react", () => ({
  captureException: h.captureExceptionMock,
}));

// Stubs the server fn `isProductionEnvironmentQuery` calls, so a query left
// unseeded in a test never makes a real (server-only) call in jsdom — it's
// only exercised by the one test that deliberately leaves the query pending.
vi.mock("~/server/env.fn", () => ({
  fetchIsProductionEnvironment: () => h.fetchIsProductionEnvironmentMock(),
}));

import { AppShell, RootErrorBoundary, rootErrorBoundaryMessage } from "./__root";

// Radix DropdownMenu (used by SiteHeader, which AppShell renders) needs the
// same jsdom stubs as SiteHeader.test.tsx / dropdown-menu.test.tsx.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

async function renderAppShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seed the cache so SiteHeader's useSuspenseQuery calls resolve without
  // invoking the real server fns (mirrors SiteHeader.test.tsx).
  queryClient.setQueryData(currentUserQuery.queryKey, null);
  queryClient.setQueryData(previewLoginEnabledQuery.queryKey, false);

  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <AppShell>
          <div>Page content</div>
        </AppShell>
      </QueryClientProvider>
    ),
  });
  // Link targets rendered by SiteHeader/SiteFooter must exist in the tree.
  const childPaths = ["/listings", "/listings/new", "/favorites", "/about", "/admin"] as const;
  const children = childPaths.map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => null })
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(children),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  // Test-only structural mismatch between the concrete router and the provider's
  // generic default — safe to assert through unknown.
  render(<RouterProvider router={router as unknown as never} />);
  // RouterProvider resolves the initial match asynchronously (mirrors
  // SiteHeader.test.tsx's `await screen.findByRole`).
  await screen.findByRole("link", { name: "Skip to main content" });
}

/**
 * Renders `RootErrorBoundary` inside a minimal router (so its `<Link to="/">`
 * — "Go home" — has router context to resolve against; a raw render without a
 * router throws, since `Link` calls `useLinkProps`, which needs `useRouter`)
 * and a `QueryClientProvider` seeded with `isProductionEnvironmentQuery`
 * (mirrors the root loader's `ensureQueryData` prefetch in `__root.tsx`).
 *
 * `isProductionData` is the seeded query value: `true`/`false` reproduce the
 * ordinary prefetched-cache case; `undefined` reproduces the boundary's own
 * fail-closed default when the root loader never got to prefetch it (nothing
 * is seeded, so `useQuery` starts from `undefined`).
 */
async function renderErrorBoundary(error: unknown, isProductionData: boolean | undefined) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (isProductionData === undefined) {
    // Simulate the root loader never having prefetched this (e.g. the root
    // loader itself is what threw): the query fn hangs forever, so `data`
    // stays `undefined` for the lifetime of the test.
    h.fetchIsProductionEnvironmentMock.mockImplementation(() => new Promise(() => {}));
  } else {
    queryClient.setQueryData(isProductionEnvironmentQuery.queryKey, isProductionData);
  }

  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <RootErrorBoundary error={error as Error} reset={() => {}} />
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router as unknown as never} />);
  await screen.findByRole("heading", { name: "Something went wrong" });
}

describe("AppShell — skip-to-content link (AUB-166)", () => {
  it("renders a 'Skip to main content' link targeting #main-content", async () => {
    await renderAppShell();

    const skipLink = screen.getByRole("link", { name: "Skip to main content" });
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute("href", "#main-content");
  });

  it("is the first focusable element in the shell, before SiteHeader's menu button", async () => {
    await renderAppShell();

    const focusable = document.querySelectorAll<HTMLElement>("a[href], button");
    expect(focusable.length).toBeGreaterThan(0);
    expect(focusable[0]).toHaveAccessibleName("Skip to main content");
  });

  it('functions: activating it moves focus to a programmatically-focusable <main id="main-content">', async () => {
    await renderAppShell();

    const skipLink = screen.getByRole("link", { name: "Skip to main content" });
    const main = document.getElementById("main-content");
    expect(main).not.toBeNull();
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(main).toContainHTML("Page content");

    // jsdom doesn't implement the browser's native "focus the fragment target
    // on anchor activation" behaviour, so simulate what the browser does:
    // clicking a same-page hash link focuses the target if it can be focused.
    fireEvent.click(skipLink);
    main?.focus();
    expect(main).toHaveFocus();
  });
});

describe("AppShell — footer mount (AUB-142)", () => {
  it("mounts SiteFooter after <main> on every route", async () => {
    await renderAppShell();

    const footer = screen.getByRole("contentinfo");
    expect(footer).toBeInTheDocument();
    // DOM order: main content should precede the footer landmark.
    const main = document.getElementById("main-content");
    expect(main?.compareDocumentPosition(footer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe("rootErrorBoundaryMessage (AUB-170)", () => {
  it("returns the real error message outside production", () => {
    expect(rootErrorBoundaryMessage(new Error("db connection refused"), false)).toBe(
      "db connection refused"
    );
  });

  it("returns a generic fallback for a non-Error thrown value outside production", () => {
    expect(rootErrorBoundaryMessage("boom", false)).toBe("An unexpected error occurred.");
  });

  it("returns a sanitized generic message in production, never the raw error text", () => {
    const message = rootErrorBoundaryMessage(
      new Error('Postgres: relation "listings" does not exist'),
      true
    );
    expect(message).not.toContain("Postgres");
    expect(message).not.toContain("listings");
    expect(message).toBe("An unexpected error occurred. Our team has been notified.");
  });
});

describe("RootErrorBoundary component", () => {
  it("shows the raw error message when the prefetched query says non-production", async () => {
    await renderErrorBoundary(new Error("something exploded"), false);

    expect(screen.getByText("something exploded")).toBeInTheDocument();
  });

  it("shows only the sanitized generic message when the prefetched query says production", async () => {
    await renderErrorBoundary(new Error("stack trace leaking internals"), true);

    expect(
      screen.getByText("An unexpected error occurred. Our team has been notified.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/stack trace leaking internals/)).not.toBeInTheDocument();
  });

  // Regression guard for the reviewed bug: a Vercel PREVIEW deployment is
  // still built in production mode, so `import.meta.env.PROD` is `true`
  // there too — it cannot tell preview apart from real production.
  // `isProductionEnvironmentQuery` is fed by `isProductionEnvironment()`
  // (`app/env.ts`), which is unit-tested directly against `VERCEL_ENV=preview`
  // in `app/env.test.ts`; here we confirm the boundary renders the RAW
  // message for that "preview" value (`false`), never the sanitized one.
  it("treats a preview deployment's query result (false) as non-production, not sanitized", async () => {
    await renderErrorBoundary(new Error("preview-only diagnostic detail"), false);

    expect(screen.getByText("preview-only diagnostic detail")).toBeInTheDocument();
    expect(
      screen.queryByText("An unexpected error occurred. Our team has been notified.")
    ).not.toBeInTheDocument();
  });

  it("fails closed to the sanitized message if the query hasn't resolved yet", async () => {
    await renderErrorBoundary(new Error("internal detail"), undefined);

    expect(
      screen.getByText("An unexpected error occurred. Our team has been notified.")
    ).toBeInTheDocument();
    expect(screen.queryByText("internal detail")).not.toBeInTheDocument();
  });

  it("still forwards the error to Sentry regardless of environment", async () => {
    const error = new Error("reported anyway");
    await renderErrorBoundary(error, true);

    expect(h.captureExceptionMock).toHaveBeenCalledWith(error);
  });
});
