import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { currentUserQuery } from "~/auth/current-user-query";
import { SiteHeader } from "./SiteHeader";

/**
 * Component tests for `SiteHeader`. It reads `useSuspenseQuery(currentUserQuery)`,
 * so the test seeds the QueryClient cache directly (via `setQueryData`) — suspense
 * resolves synchronously and the real server fn is never called. The header
 * renders TanStack Router `<Link>`s, so its link targets must exist in the tree.
 *
 * Radix DropdownMenu needs the same jsdom stubs as dropdown-menu.test.tsx.
 */
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

function renderHeader() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seed the cache so useSuspenseQuery resolves without invoking the server fn.
  queryClient.setQueryData(currentUserQuery.queryKey, null);

  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <SiteHeader />
      </QueryClientProvider>
    ),
  });
  // Link targets must exist in the tree for `Link` to resolve.
  const childPaths = ["/listings", "/listings/new", "/about", "/admin"] as const;
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
}

describe("SiteHeader — mobile hamburger menu", () => {
  it("exposes every NAV_ITEMS label when the hamburger menu is opened", async () => {
    renderHeader();

    const trigger = await screen.findByRole("button", { name: "Open menu" });
    // Open via the keyboard path — jsdom can't fully synthesize Radix's pointer
    // open (mirrors dropdown-menu.test.tsx).
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(screen.getByRole("menuitem", { name: "Browse" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Add a listing" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "About" })).toBeInTheDocument();
  });
});
