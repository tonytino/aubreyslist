import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "~/auth/current-user-query";
import { currentUserQuery } from "~/auth/current-user-query";
import type { Listing } from "~/db/schema";
import { favoriteIdsQuery } from "~/favorites/favorites-query";
import { viewerFavoritesQuery } from "~/favorites/viewer-favorites-query";
import type { BrowseListingCard } from "~/server/listings/browse";
import type { ListingTrustGlance } from "~/trust/browse-glance";
import { FavoritesPage, Route } from "./favorites";

/**
 * Route smoke test for `/favorites` (AUB-127 / F9). `FavoritesPage` reads three
 * suspense queries (current-user, viewer-favorites, and — via the cards' heart
 * buttons — the favorited-id set), so we seed the QueryClient cache directly and
 * suspense resolves synchronously with no server fn called. It renders TanStack
 * Router `<Link>`s, so link targets must exist in the mounted tree.
 *
 * Radix (used deep in the card's FavoriteButton dialog) needs the jsdom pointer
 * stubs the other dropdown/menu tests use.
 */
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const user: SessionUser = {
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  avatarUrl: null,
  role: "user",
};

/** A minimal visible listing + neutral glance → one favorites browse card. */
function makeCard(id: string, name: string): BrowseListingCard {
  const listing = {
    id,
    name,
    address: "123 Test St",
    lat: 39.75,
    lng: -105,
    moderationStatus: "visible",
  } as unknown as Listing;
  const glance: ListingTrustGlance = {
    safetyState: null,
    hasRecentIncident: false,
  } as ListingTrustGlance;
  return { listing, glance, favoriteCount: 3 };
}

function renderFavorites(opts: {
  currentUser: SessionUser | null;
  favorites: BrowseListingCard[];
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seed every suspense source so the page resolves without a server fn.
  queryClient.setQueryData(currentUserQuery.queryKey, opts.currentUser);
  queryClient.setQueryData(viewerFavoritesQuery.queryKey, opts.favorites);
  queryClient.setQueryData(favoriteIdsQuery.queryKey, []);

  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <FavoritesPage />
      </QueryClientProvider>
    ),
  });
  // Link targets must exist in the tree for `Link` to resolve.
  const childPaths = ["/", "/listings/$id"] as const;
  const children = childPaths.map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => null })
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(children),
    history: createMemoryHistory({ initialEntries: ["/favorites"] }),
  });
  // Test-only structural mismatch between the concrete router and the provider's
  // generic default — safe to assert through unknown (mirrors SiteHeader.test).
  render(<RouterProvider router={router as unknown as never} />);
}

describe("FavoritesPage — three states", () => {
  it("ANONYMOUS: shows a sign-in CTA returning to /favorites", async () => {
    renderFavorites({ currentUser: null, favorites: [] });

    const cta = await screen.findByRole("link", { name: /sign in with google/i });
    expect(cta).toHaveAttribute("href", "/api/auth/google?returnTo=/favorites");
  });

  it("SIGNED-IN EMPTY: nudges the diner to save from the directory", async () => {
    renderFavorites({ currentUser: user, favorites: [] });

    expect(await screen.findByText(/no saved spots yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse listings/i })).toBeInTheDocument();
  });

  it("SIGNED-IN POPULATED: renders the saved cards with the save-count pill", async () => {
    renderFavorites({ currentUser: user, favorites: [makeCard("listing-1", "Blue Sparrow")] });

    expect(await screen.findByText("Blue Sparrow")).toBeInTheDocument();
    // The save-count pill (F10) rides along from `favoriteCount`.
    expect(screen.getByTestId("save-count")).toHaveTextContent("3");
  });
});

describe("FavoritesPage — head() meta tags (AUB-163)", () => {
  it("includes noindex,nofollow robots meta tag in head", async () => {
    const headCtx = {} as Parameters<NonNullable<typeof Route.options.head>>[0];
    const headDataOrPromise = Route.options.head?.(headCtx);
    const headData =
      headDataOrPromise instanceof Promise ? await headDataOrPromise : headDataOrPromise;
    expect(headData).toBeDefined();
    expect(headData?.meta).toBeDefined();

    const robotsMeta = (headData?.meta ?? []).find((m) => m?.name === "robots");
    expect(robotsMeta).toBeDefined();
    expect(robotsMeta?.content).toBe("noindex,nofollow");
  });
});
