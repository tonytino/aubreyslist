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
import { deriveListingActivityMeta } from "~/trust/summary";
import { FavoritesPage, Route } from "./favorites";

/**
 * Route smoke test for `/favorites`. `FavoritesPage` reads three suspense
 * queries, so the QueryClient cache is seeded directly and suspense resolves
 * synchronously with no server fn called. It renders TanStack Router
 * `<Link>`s, so link targets must exist in the mounted tree.
 *
 * Radix (used in the card's FavoriteButton dialog) needs the jsdom pointer
 * stubs.
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
    suggestedByBot: false,
    suggestedAttributes: [],
    confirmedAttributes: [],
    evidence: null,
    freshness: null,
    activity: deriveListingActivityMeta(null),
  };
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
  // Test-only structural mismatch between the concrete router and the
  // provider's generic default — safe to assert through unknown.
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

  it("SIGNED-IN POPULATED: renders the saved cards with the compact save-count pill", async () => {
    renderFavorites({ currentUser: user, favorites: [makeCard("listing-1", "Blue Sparrow")] });

    expect(await screen.findByText("Blue Sparrow")).toBeInTheDocument();
    // The save-count pill rides along from `favoriteCount` — heart + count
    // only, no visible "saves" word.
    const pill = screen.getByTestId("save-count");
    expect(pill).toHaveTextContent("3");
    expect(pill).not.toHaveTextContent("saves");
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
