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
import type { Listing } from "~/db/schema";
import type { ListingTrustGlance } from "~/trust/browse-glance";
import { ListingCard, RestaurantCard, type RestaurantCardVM } from "./ListingCard";

/**
 * Tests for the browse-list card (#33, AUB-61 redesign). Covers the trust-glance
 * render across states — celiac-safe, gluten-friendly, the honest "Not yet
 * attested" empty state, the recent-incident flag — plus the redesign's new
 * surface: the attributed (non-safety) Google rating pill, evidence counts, and
 * the photo placeholder vs `<img>`. The accessible signals (colour + icon + TEXT
 * label) are asserted via their visible text, never colour.
 *
 * The card uses TanStack Router's `Link`, so it must render inside a router. We
 * mount a tiny in-memory router whose tree includes the `/listings/$id` target so
 * `Link` can resolve its href without the full app route tree.
 */

const baseVm: RestaurantCardVM = {
  id: "listing-1",
  name: "Acme Gluten-Free",
  address: "123 Main St, Denver, CO",
  safetyState: "celiac-safe",
  hasRecentIncident: false,
  accent: "lavender",
};

const baseListing: Listing = {
  id: "listing-1",
  placeId: null,
  name: "Acme Gluten-Free",
  address: "123 Main St, Denver, CO",
  lat: 39.7392,
  lng: -104.9903,
  mapsUrl: "https://maps.google.com/?q=acme",
  menuUrl: null,
  moderationStatus: "visible",
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Mount `element` inside a minimal router that can resolve `/listings/$id`. */
function renderInRouter(element: ReactNode) {
  const rootRoute = createRootRoute();
  const browseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <>{element}</>,
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

function renderCard(overrides: Partial<RestaurantCardVM> = {}) {
  renderInRouter(<RestaurantCard vm={{ ...baseVm, ...overrides }} />);
}

describe("RestaurantCard", () => {
  it("renders the listing name and address", async () => {
    renderCard();
    expect(await screen.findByRole("heading", { name: "Acme Gluten-Free" })).toBeInTheDocument();
    expect(screen.getByText(/123 Main St, Denver, CO/)).toBeInTheDocument();
  });

  it("appends the distance label to the location line when provided", async () => {
    renderCard({ distanceLabel: "0.4 mi" });
    expect(await screen.findByText("123 Main St, Denver, CO · 0.4 mi")).toBeInTheDocument();
  });

  it("links the whole card to the listing detail page", async () => {
    renderCard();
    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "/listings/listing-1");
  });

  it("renders the save button as a sibling of the link, not nested in the anchor", async () => {
    renderCard();
    // The stretched-link pattern keeps a valid DOM: the <button> must NOT be a
    // descendant of the <a> (a button inside an anchor is invalid HTML + an a11y
    // defect). Both remain independently present.
    const link = await screen.findByRole("link");
    const saveButton = screen.getByRole("button", { name: "Save this spot" });
    expect(saveButton).toBeInTheDocument();
    expect(link).not.toContainElement(saveButton);
    expect(saveButton).not.toContainElement(link);
  });

  it("shows the SafetySignal for a non-null state (text, not colour alone)", async () => {
    renderCard({ safetyState: "celiac-safe" });
    expect(await screen.findByText("Celiac-safe")).toBeInTheDocument();
  });

  it("shows the gluten-friendly label", async () => {
    renderCard({ safetyState: "gluten-friendly" });
    expect(await screen.findByText("Gluten-friendly")).toBeInTheDocument();
  });

  it("renders an honest Not yet attested state when safetyState is null", async () => {
    renderCard({ safetyState: null });
    expect(await screen.findByText("Not yet attested")).toBeInTheDocument();
    expect(screen.queryByText("Celiac-safe")).not.toBeInTheDocument();
  });

  it("shows the recent-incident warning when a recent incident exists", async () => {
    renderCard({ safetyState: "celiac-safe", hasRecentIncident: true });
    expect(await screen.findByText("Celiac-safe")).toBeInTheDocument();
    expect(screen.getByText("Recent incident")).toBeInTheDocument();
  });

  it("does not show the incident warning when there is no recent incident", async () => {
    renderCard({ hasRecentIncident: false });
    await screen.findByText("Celiac-safe");
    expect(screen.queryByText("Recent incident")).not.toBeInTheDocument();
  });

  it("does not render a Google rating pill when googleRating is absent", async () => {
    renderCard({ googleRating: null });
    await screen.findByText("Celiac-safe");
    expect(screen.queryByTestId("google-rating")).not.toBeInTheDocument();
    expect(screen.queryByText("Google")).not.toBeInTheDocument();
  });

  it("renders an ATTRIBUTED Google rating pill only when googleRating is present", async () => {
    renderCard({ googleRating: { value: 4.8, count: 128 } });
    const pill = await screen.findByTestId("google-rating");
    // The value is shown AND explicitly attributed to Google...
    expect(pill).toHaveTextContent("4.8");
    expect(pill).toHaveTextContent("Google");
    // ...and it is NOT presented as a safety verdict (ADR-007): no safety label,
    // and it carries no SafetySignal state marker.
    expect(pill).not.toHaveTextContent(/celiac|safe|gluten/i);
    expect(pill).not.toHaveAttribute("data-safety-state");
  });

  it("renders evidence counts when present", async () => {
    renderCard({ evidence: { confirmations: 128, contributors: 41 } });
    expect(await screen.findByText("128 confirmations · 41 neighbors")).toBeInTheDocument();
  });

  it("renders a freshness cue with its label when present", async () => {
    renderCard({ freshness: { kind: "fresh", label: "Verified 3d ago" } });
    expect(await screen.findByText("Verified 3d ago")).toBeInTheDocument();
  });

  it("renders the accent placeholder tile when no photoUrl is given", async () => {
    renderCard({ photoUrl: null });
    expect(await screen.findByText("Food photo")).toBeInTheDocument();
    expect(screen.queryByTestId("food-photo")).not.toBeInTheDocument();
  });

  it("renders an <img> instead of the placeholder when photoUrl is set", async () => {
    renderCard({ photoUrl: "https://cdn.example.com/root-and-rye.jpg" });
    // The photo is decorative (alt=""), so it has no `img` role — assert on src.
    const img = await screen.findByTestId("food-photo");
    expect(img).toHaveAttribute("src", "https://cdn.example.com/root-and-rye.jpg");
    expect(screen.queryByText("Food photo")).not.toBeInTheDocument();
  });
});

describe("ListingCard (compatibility wrapper)", () => {
  function renderWrapper(glance: ListingTrustGlance) {
    renderInRouter(<ListingCard listing={baseListing} glance={glance} />);
  }

  it("maps a Listing + glance onto the card and links to the detail page", async () => {
    renderWrapper({ safetyState: "celiac-safe", hasRecentIncident: false });
    expect(await screen.findByRole("heading", { name: "Acme Gluten-Free" })).toBeInTheDocument();
    expect(screen.getByText(/123 Main St, Denver, CO/)).toBeInTheDocument();
    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "/listings/listing-1");
  });

  it("passes the null safetyState through to the honest Not yet attested chip", async () => {
    renderWrapper({ safetyState: null, hasRecentIncident: false });
    expect(await screen.findByText("Not yet attested")).toBeInTheDocument();
  });

  it("passes the recent-incident flag through", async () => {
    renderWrapper({ safetyState: "celiac-safe", hasRecentIncident: true });
    expect(await screen.findByText("Recent incident")).toBeInTheDocument();
  });
});
