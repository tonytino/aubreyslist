import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "~/auth/current-user-query";

/**
 * Tests for the post-sign-in pending-favorite handler (issue AUB-124 / F8b).
 *
 * The hook reads a `?save=<id>` marker off the router location, fires the
 * `favoriteListing` server fn exactly once for a signed-in viewer, strips the
 * marker from the URL, and refreshes the favorites query. We mock the router
 * (`useRouterState`) to drive the search string, mock the server-fn seam so no
 * network/DB is touched, and seed the current-user query directly in a real
 * QueryClient to toggle signed-in vs anonymous.
 */

// Controlled router location search string, mutated per test. `vi.hoisted` so
// the mock factory (hoisted above imports) can reference it safely.
const routerState = vi.hoisted(() => ({ searchStr: "" }));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: <T,>(opts: { select: (s: { location: { searchStr: string } }) => T }): T =>
    opts.select({ location: { searchStr: routerState.searchStr } }),
}));

const favoriteListingMock = vi.fn<(args: { data: { listingId: string } }) => Promise<unknown>>(() =>
  Promise.resolve({ ok: true })
);
// The hook imports `favoriteListing`; `favoriteIdsQuery` (also imported) pulls in
// `fetchViewerFavoriteIds` from the same seam, so both are mocked here to keep
// the DB-touching `~/server/favorites/index` graph out of the test.
vi.mock("~/server/favorites/favorites.fn", () => ({
  favoriteListing: (args: { data: { listingId: string } }) => favoriteListingMock(args),
  fetchViewerFavoriteIds: () => Promise.resolve([] as string[]),
}));

// currentUserQuery imports the current-user server fn (which reaches for db).
// Mock it so importing the query is side-effect-free; the resolved value never
// runs because we seed the cache below.
vi.mock("~/server/auth/current-user.fn", () => ({
  fetchCurrentUser: () => Promise.resolve(null),
}));

import { currentUserQuery } from "~/auth/current-user-query";
import { PendingFavoriteHandler, __resetPendingFavoriteGuard } from "./use-pending-favorite";

const signedInUser: SessionUser = {
  id: "user-1",
  name: "Aubrey",
  email: "aubrey@example.com",
  avatarUrl: null,
  role: "user",
};

function newClient(user: SessionUser | null): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seed the current-user cache so `useSuspenseQuery` resolves synchronously
  // (no fetch, no suspend) with the auth state under test.
  client.setQueryData(currentUserQuery.queryKey, user);
  return client;
}

function renderHandler(client: QueryClient, wrap?: (node: ReactNode) => ReactNode) {
  const tree = <PendingFavoriteHandler />;
  return render(
    <QueryClientProvider client={client}>{wrap ? wrap(tree) : tree}</QueryClientProvider>
  );
}

/** Point the jsdom URL at a path carrying the given search, and mirror it to the mocked router. */
function setLocation(path: string): void {
  window.history.replaceState({}, "", path);
  const query = path.includes("?") ? `?${path.split("?")[1]}` : "";
  routerState.searchStr = query;
}

beforeEach(() => {
  __resetPendingFavoriteGuard();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  routerState.searchStr = "";
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("PendingFavoriteHandler", () => {
  it("fires favoriteListing once and strips the save param when signed in", async () => {
    setLocation("/listings/listing-1?save=listing-1&ref=email");
    const replaceSpy = vi.spyOn(window.history, "replaceState");

    renderHandler(newClient(signedInUser));

    await waitFor(() => expect(favoriteListingMock).toHaveBeenCalledTimes(1));
    expect(favoriteListingMock).toHaveBeenCalledWith({ data: { listingId: "listing-1" } });

    // The `save` marker is stripped; the rest of the path + other params survive.
    expect(replaceSpy).toHaveBeenCalled();
    expect(window.location.pathname).toBe("/listings/listing-1");
    expect(window.location.search).toBe("?ref=email");
  });

  it("does NOT double-write on a second return with the same marker (re-mount)", async () => {
    setLocation("/listings/listing-2?save=listing-2");
    const client = newClient(signedInUser);

    const first = renderHandler(client);
    await waitFor(() => expect(favoriteListingMock).toHaveBeenCalledTimes(1));
    first.unmount();

    // Second return: same marker re-appears (e.g. back/forward or a re-nav).
    setLocation("/listings/listing-2?save=listing-2");
    renderHandler(client);

    // Give any stray effect a chance to fire, then assert it stayed at one.
    await Promise.resolve();
    expect(favoriteListingMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT double-write under React strict-mode's double-invoke", async () => {
    setLocation("/listings/listing-3?save=listing-3");

    renderHandler(newClient(signedInUser), (node) => <StrictMode>{node}</StrictMode>);

    await waitFor(() => expect(favoriteListingMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(favoriteListingMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT write and leaves the marker when the viewer is anonymous", async () => {
    setLocation("/listings/listing-4?save=listing-4");
    const replaceSpy = vi.spyOn(window.history, "replaceState");

    renderHandler(newClient(null));

    await Promise.resolve();
    expect(favoriteListingMock).not.toHaveBeenCalled();
    // Marker is preserved (no replaceState from the handler) for a later signed-in return.
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?save=listing-4");
  });
});
