import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AddSpotFab } from "./AddSpotFab";

/** Mount `element` inside a minimal router that can resolve `/listings/new`. */
function renderInRouter(element: ReactNode) {
  const rootRoute = createRootRoute();
  const browseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <>{element}</>,
  });
  const newRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/listings/new",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([browseRoute, newRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router as unknown as never} />);
}

describe("AddSpotFab", () => {
  it("links to the add-listing route and is labelled 'Add listing'", async () => {
    renderInRouter(<AddSpotFab />);
    const link = await screen.findByRole("link", { name: "Add listing" });
    expect(link).toHaveAttribute("href", "/listings/new");
  });
});
