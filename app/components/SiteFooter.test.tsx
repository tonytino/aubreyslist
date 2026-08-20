import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "./SiteFooter";

/**
 * Component tests for `SiteFooter`. Mirrors `SiteHeader.test.tsx`: the footer
 * renders TanStack Router `<Link>`s, so its link targets must exist as routes
 * in the test tree, and it's exercised through a real `RouterProvider` rather
 * than a raw render.
 */
async function renderFooter() {
  const rootRoute = createRootRoute({
    component: () => <SiteFooter />,
  });
  // Every link target SiteFooter renders must exist in the tree for `Link` to
  // resolve (mirrors SiteHeader.test.tsx's childPaths list).
  const childPaths = ["/listings/new", "/favorites", "/about"] as const;
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
  // SiteHeader.test.tsx's `await screen.findByRole` for its first query).
  return screen.findByRole("link", { name: "Aubrey's List home" });
}

describe("SiteFooter", () => {
  it("renders the brand wordmark linking home", async () => {
    const homeLink = await renderFooter();

    expect(homeLink).toBeInTheDocument();
    expect(homeLink).toHaveAttribute("href", "/");
  });

  it("exposes every real Explore link", async () => {
    await renderFooter();

    const nav = screen.getByRole("navigation", { name: "Footer" });
    expect(nav).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Browse" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Add a listing" })).toHaveAttribute(
      "href",
      "/listings/new"
    );
    expect(screen.getByRole("link", { name: "Favorites" })).toHaveAttribute("href", "/favorites");
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
  });

  it("does not link to any not-yet-existing legal route", async () => {
    await renderFooter();

    // The legal-links slot (privacy/terms/disclaimer/moderation/contact) is
    // reserved but unpopulated until those routes ship — asserting their
    // absence guards against an accidental 404 link.
    for (const label of [
      "Privacy policy",
      "Terms of service",
      "Disclaimer",
      "Moderation policy",
      "Contact",
    ]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
  });

  it("renders a copyright line with the current year", async () => {
    await renderFooter();

    const year = new Date().getFullYear().toString();
    expect(screen.getByText(new RegExp(`© ${year} Aubrey's List`))).toBeInTheDocument();
  });
});
