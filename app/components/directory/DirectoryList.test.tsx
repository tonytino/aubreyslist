import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { currentUserQuery } from "~/auth/current-user-query";
import type { RestaurantCardVM } from "~/components/listing/ListingCard";
import { favoriteIdsQuery } from "~/favorites/favorites-query";
import { DirectoryList } from "./DirectoryList";

// Each card now embeds the FavoriteButton island (F6, AUB-125), which imports the
// db-touching `favorites.fn` seam; mock it out (as FavoriteButton.test.tsx does).
vi.mock("~/server/favorites/favorites.fn", () => ({
  favoriteListing: vi.fn(() => Promise.resolve()),
  unfavoriteListing: vi.fn(() => Promise.resolve()),
}));

/**
 * Tests for the List view (AUB-61). Covers that every view-model renders as a
 * card in the responsive grid. The cards use TanStack Router's `Link`, so we
 * mount a minimal in-memory router whose tree includes `/listings/$id` (mirrors
 * ListingCard.test.tsx).
 */

const vms: RestaurantCardVM[] = [
  {
    id: "listing-1",
    name: "Acme Gluten-Free",
    address: "123 Main St, Denver, CO",
    safetyState: "celiac-safe",
    suggestedByBot: false,
    suggestedAttributes: [],
    hasRecentIncident: false,
    accent: "lavender",
  },
  {
    id: "listing-2",
    name: "Second Spot",
    address: "456 Elm St, Denver, CO",
    safetyState: "gluten-friendly",
    suggestedByBot: false,
    suggestedAttributes: [],
    hasRecentIncident: false,
    accent: "mint",
  },
];

function renderInRouter(element: ReactNode) {
  const rootRoute = createRootRoute();
  const browseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <>{element}</>,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/listings/$id",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([browseRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  // Seed the favorites + current-user suspense queries the embedded FavoriteButton
  // reads (anonymous, no favorites) so each card's heart renders synchronously.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(favoriteIdsQuery.queryKey, []);
  queryClient.setQueryData(currentUserQuery.queryKey, null);
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as unknown as never} />
    </QueryClientProvider>
  );
}

describe("DirectoryList", () => {
  it("renders one card per view-model", async () => {
    renderInRouter(<DirectoryList cards={vms} />);
    expect(await screen.findByRole("heading", { name: "Acme Gluten-Free" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Second Spot" })).toBeInTheDocument();
    // The cards render as list items inside the grid.
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("lays the cards out in a responsive multi-column grid", async () => {
    renderInRouter(<DirectoryList cards={vms} />);
    // Wait for the router-linked cards to mount, then assert the grid widens on
    // larger breakpoints so the full-width shell (user feedback #1) fills up.
    await screen.findByRole("heading", { name: "Acme Gluten-Free" });
    const list = screen.getByRole("list");
    expect(list).toHaveClass("md:grid-cols-2", "xl:grid-cols-3", "2xl:grid-cols-4");
  });
});
