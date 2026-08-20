import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "~/auth/current-user-query";
import { currentUserQuery } from "~/auth/current-user-query";
import { previewLoginEnabledQuery } from "~/auth/preview-login-query";
import { SiteHeader } from "./SiteHeader";

/**
 * Component tests for `SiteHeader`. It reads `useSuspenseQuery(currentUserQuery)`,
 * so the test seeds the QueryClient cache directly (via `setQueryData`) — suspense
 * resolves synchronously and the real server fn is never called. The header
 * renders TanStack Router `<Link>`s, so its link targets must exist in the tree.
 *
 * jsdom has no real media queries, so both the mobile combined menu and the
 * desktop inline nav render into the DOM (`sm:` visibility is a CSS class jsdom
 * doesn't evaluate). Assert structure and classes, not computed layout: the
 * combined-menu trigger by its `Open menu` label, the desktop inline nav by its
 * `link` roles (the menu's copies are `menuitem`s, so roles disambiguate).
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

function renderHeader(user: SessionUser | null = null, previewLoginEnabled = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seed the cache so useSuspenseQuery resolves without invoking the server fn.
  queryClient.setQueryData(currentUserQuery.queryKey, user);
  queryClient.setQueryData(previewLoginEnabledQuery.queryKey, previewLoginEnabled);

  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <SiteHeader />
      </QueryClientProvider>
    ),
  });
  // Link targets must exist in the tree for `Link` to resolve.
  const childPaths = ["/listings", "/listings/new", "/about", "/admin", "/favorites"] as const;
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

function openCombinedMenu(triggerName: string | RegExp) {
  const trigger = screen.getByRole("button", { name: triggerName });
  // Open via the keyboard path — jsdom can't fully synthesize Radix's pointer
  // open (mirrors dropdown-menu.test.tsx).
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return trigger;
}

describe("SiteHeader — mobile combined menu (below sm)", () => {
  it("groups the primary nav and account rows under Navigate + Account sections", async () => {
    renderHeader();
    await screen.findByRole("button", { name: "Open menu" });
    openCombinedMenu("Open menu");

    // Section headers group the menu (meaning is carried by text, not colour).
    expect(screen.getByText("Navigate")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();

    // Navigate group: every NAV_ITEMS label, as menu items (the desktop inline
    // copies are `link`s, so the `menuitem` role scopes us to the menu).
    expect(screen.getByRole("menuitem", { name: "Browse" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Add a listing" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "About" })).toBeInTheDocument();

    // Account group (signed out): the theme row + Log in.
    expect(
      screen.getByRole("menuitem", { name: /Switch to (dark|light) theme/ })
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Log in" })).toBeInTheDocument();
  });

  it("keeps the Primary nav landmark wrapping the trigger and gives it a >=44px touch area", async () => {
    renderHeader();
    const trigger = await screen.findByRole("button", { name: "Open menu" });

    // The nav landmark must keep wrapping the trigger even though the items live
    // in a portaled menu.
    expect(trigger.closest("nav")).toHaveAttribute("aria-label", "Primary");
    // h-11 = 44px — the combined-menu trigger is a comfortable touch target.
    expect(trigger.className).toContain("h-11");
  });

  it("labels the signed-in trigger with the user's name and shows an Account identity", async () => {
    const user: SessionUser = {
      id: "u1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      avatarUrl: null,
      role: "user",
    };
    renderHeader(user);
    const label = "Open menu, signed in as Ada Lovelace";
    await screen.findByRole("button", { name: label });
    openCombinedMenu(label);

    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Favorites" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });
});

describe("SiteHeader — desktop split layout (sm+)", () => {
  it("renders the primary nav as directly-reachable inline links", async () => {
    renderHeader();
    // The inline nav links are `link`s (the combined-menu copies are `menuitem`s).
    const browse = await screen.findByRole("link", { name: "Browse" });
    expect(browse.closest("nav")).toHaveAttribute("aria-label", "Primary");
    expect(browse).toHaveAttribute("href", "/");
  });

  it("renders 'Add a listing' as the brand-purple primary CTA", async () => {
    renderHeader();
    const cta = await screen.findByRole("link", { name: "Add a listing" });
    // The default Button variant paints the brand primary — the CTA is not a
    // plain ghost link.
    expect(cta.className).toContain("bg-primary");
    expect(cta).toHaveAttribute("href", "/listings/new");
  });
});
