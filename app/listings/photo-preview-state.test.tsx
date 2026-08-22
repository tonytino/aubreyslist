import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { listingPreviewLinkState, useListingPreviewSrc } from "./photo-preview-state";

function DetailProbe() {
  const previewSrc = useListingPreviewSrc();
  return <span>{previewSrc ?? "none"}</span>;
}

/** A two-route memory router: a Link (optionally carrying preview state) to a probe that reads it back. */
function renderNav(linkState?: ReturnType<typeof listingPreviewLinkState>) {
  const rootRoute = createRootRoute();
  const fromRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <Link to="/listings/$id" params={{ id: "listing-1" }} {...(linkState ?? {})}>
        Go
      </Link>
    ),
  });
  const toRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/listings/$id",
    component: DetailProbe,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([fromRoute, toRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  // The concrete router type doesn't match the provider's generic default; this
  // is a test-only structural mismatch, safe to assert through unknown.
  render(<RouterProvider router={router as unknown as never} />);
}

describe("listingPreviewLinkState", () => {
  it("wraps a photo URL as router state under listingPreviewSrc", () => {
    expect(listingPreviewLinkState("https://cdn.example.com/x.jpg")).toEqual({
      state: { listingPreviewSrc: "https://cdn.example.com/x.jpg" },
    });
  });
});

describe("useListingPreviewSrc", () => {
  it("reads the previewSrc carried by the Link's state", async () => {
    renderNav(listingPreviewLinkState("https://cdn.example.com/x.jpg"));
    fireEvent.click(await screen.findByRole("link"));
    expect(await screen.findByText("https://cdn.example.com/x.jpg")).toBeInTheDocument();
  });

  it("is undefined on a direct visit (no state)", async () => {
    renderNav();
    fireEvent.click(await screen.findByRole("link"));
    expect(await screen.findByText("none")).toBeInTheDocument();
  });
});
