import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Listing } from "~/db/schema";
import type { ListingTrustGlance } from "~/trust/browse-glance";
import { ListingCard } from "./ListingCard";

/**
 * Tests for the browse-list card (#33). Covers the trust-glance render across
 * states — celiac-safe, gluten-friendly, the honest "Not yet attested" empty
 * state, and the recent-incident flag — and that the card links to the detail
 * page. The accessible signals (colour + icon + TEXT label) are asserted via
 * their visible text, never colour.
 *
 * `ListingCard` uses TanStack Router's `Link`, so it must render inside a router.
 * We mount a tiny in-memory router whose tree includes the `/listings/$id` target
 * so `Link` can resolve its href without the full app route tree.
 */

const baseListing: Listing = {
  id: "listing-1",
  placeId: null,
  name: "Acme Gluten-Free",
  address: "123 Main St, Denver, CO",
  lat: 39.7392,
  lng: -104.9903,
  mapsUrl: "https://maps.google.com/?q=acme",
  menuUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function renderCard(glance: ListingTrustGlance) {
  const rootRoute = createRootRoute();
  const browseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <ListingCard listing={baseListing} glance={glance} />,
  });
  // The link target must exist in the tree for `Link` to type/resolve.
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/listings/$id",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([browseRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  // The concrete router type doesn't match the provider's generic default; this
  // is a test-only structural mismatch, safe to assert through unknown.
  render(<RouterProvider router={router as unknown as never} />);
}

describe("ListingCard", () => {
  it("renders the listing name and address", async () => {
    renderCard({ safetyState: "celiac-safe", hasRecentIncident: false });
    expect(await screen.findByRole("heading", { name: "Acme Gluten-Free" })).toBeInTheDocument();
    expect(screen.getByText("123 Main St, Denver, CO")).toBeInTheDocument();
  });

  it("links to the listing detail page", async () => {
    renderCard({ safetyState: "celiac-safe", hasRecentIncident: false });
    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "/listings/listing-1");
  });

  it("shows the celiac-safe label (text, not colour alone)", async () => {
    renderCard({ safetyState: "celiac-safe", hasRecentIncident: false });
    expect(await screen.findByText("Celiac-safe")).toBeInTheDocument();
  });

  it("shows the gluten-friendly label", async () => {
    renderCard({ safetyState: "gluten-friendly", hasRecentIncident: false });
    expect(await screen.findByText("Gluten-friendly")).toBeInTheDocument();
  });

  it("renders an honest Not yet attested state when there is no evidence", async () => {
    renderCard({ safetyState: null, hasRecentIncident: false });
    expect(await screen.findByText("Not yet attested")).toBeInTheDocument();
    expect(screen.queryByText("Celiac-safe")).not.toBeInTheDocument();
  });

  it("shows the recent-incident warning when a recent incident exists", async () => {
    renderCard({ safetyState: "celiac-safe", hasRecentIncident: true });
    expect(await screen.findByText("Celiac-safe")).toBeInTheDocument();
    expect(screen.getByText("Recent incident")).toBeInTheDocument();
  });

  it("does not show the incident warning when there is no recent incident", async () => {
    renderCard({ safetyState: "celiac-safe", hasRecentIncident: false });
    await screen.findByText("Celiac-safe");
    expect(screen.queryByText("Recent incident")).not.toBeInTheDocument();
  });
});
