import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the FavoriteButton island (AUB-123 / F5). The favorite/unfavorite
 * server functions and the toast are mocked; we assert the anonymous gate opens
 * the dialog and performs NO write, the signed-in optimistic toggle (cache flips
 * immediately on and off), the error rollback (+ toast), and the a11y attributes.
 */
const favoriteListingMock = vi.fn((_args: unknown) => Promise.resolve());
const unfavoriteListingMock = vi.fn((_args: unknown) => Promise.resolve());
vi.mock("~/server/favorites/favorites.fn", () => ({
  favoriteListing: (args: unknown) => favoriteListingMock(args),
  unfavoriteListing: (args: unknown) => unfavoriteListingMock(args),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from "sonner";

import { currentUserQuery } from "~/auth/current-user-query";
import { favoriteIdsQuery } from "~/favorites/favorites-query";
import type { SessionUser } from "~/server/auth/current-user.fn";
import { FavoriteButton } from "./FavoriteButton";

const SIGNED_IN_USER: SessionUser = {
  id: "user-1",
  name: "Test Diner",
  email: "diner@example.com",
  avatarUrl: null,
  role: "user",
};

/**
 * Seed both suspense queries so `useSuspenseQuery` resolves synchronously
 * without invoking the (mocked-away) server fns, then render under a provider.
 */
function renderButton({
  signedIn,
  favoriteIds = [],
  ui,
}: {
  signedIn: boolean;
  favoriteIds?: string[];
  ui: ReactElement;
}): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(favoriteIdsQuery.queryKey, favoriteIds);
  queryClient.setQueryData(currentUserQuery.queryKey, signedIn ? SIGNED_IN_USER : null);
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return queryClient;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("FavoriteButton", () => {
  it("anonymous click opens the sign-in dialog and performs NO write", async () => {
    renderButton({
      signedIn: false,
      ui: <FavoriteButton listingId="listing-1" listingName="Blue Sparrow" />,
    });

    fireEvent.click(screen.getByRole("button", { name: /save blue sparrow/i }));

    // The dialog appears with a sign-in link carrying the returnTo save marker...
    const signInLink = await screen.findByRole("link", { name: /sign in/i });
    expect(signInLink).toHaveAttribute(
      "href",
      expect.stringContaining("/api/auth/google?returnTo=")
    );
    expect(decodeURIComponent(signInLink.getAttribute("href") ?? "")).toContain("save=listing-1");

    // ...and crucially NO favorite/unfavorite write was attempted.
    expect(favoriteListingMock).not.toHaveBeenCalled();
    expect(unfavoriteListingMock).not.toHaveBeenCalled();
  });

  it("signed-in click favorites optimistically (cache flips immediately)", async () => {
    const queryClient = renderButton({
      signedIn: true,
      favoriteIds: [],
      ui: <FavoriteButton listingId="listing-1" listingName="Blue Sparrow" />,
    });

    fireEvent.click(screen.getByRole("button", { name: /save blue sparrow/i }));

    // Optimistic: the cache flips to include the id synchronously in onMutate.
    await waitFor(() => {
      expect(queryClient.getQueryData<string[]>(favoriteIdsQuery.queryKey)).toContain("listing-1");
    });
    expect(favoriteListingMock).toHaveBeenCalledWith({ data: { listingId: "listing-1" } });
    expect(unfavoriteListingMock).not.toHaveBeenCalled();

    // The label + aria-pressed flip to the "saved" state.
    expect(screen.getByRole("button", { name: /saved — remove blue sparrow/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Saved to your spots");
    });
  });

  it("signed-in click unfavorites optimistically when already favorited", async () => {
    const queryClient = renderButton({
      signedIn: true,
      favoriteIds: ["listing-1"],
      ui: <FavoriteButton listingId="listing-1" listingName="Blue Sparrow" />,
    });

    fireEvent.click(screen.getByRole("button", { name: /saved — remove blue sparrow/i }));

    await waitFor(() => {
      expect(queryClient.getQueryData<string[]>(favoriteIdsQuery.queryKey)).not.toContain(
        "listing-1"
      );
    });
    expect(unfavoriteListingMock).toHaveBeenCalledWith({ data: { listingId: "listing-1" } });
    expect(favoriteListingMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Removed from your saved spots");
    });
  });

  it("rolls back the optimistic state and shows a toast when the write fails", async () => {
    favoriteListingMock.mockRejectedValueOnce(new Error("boom"));
    const queryClient = renderButton({
      signedIn: true,
      favoriteIds: [],
      ui: <FavoriteButton listingId="listing-1" listingName="Blue Sparrow" />,
    });

    fireEvent.click(screen.getByRole("button", { name: /save blue sparrow/i }));

    // Error path rolls the cache back to the pre-click snapshot and toasts.
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledTimes(1);
    });
    expect(queryClient.getQueryData<string[]>(favoriteIdsQuery.queryKey)).not.toContain(
      "listing-1"
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("exposes the a11y attributes: aria-pressed + label flip", () => {
    // Not favorited: aria-pressed=false, "Save …" label.
    renderButton({
      signedIn: true,
      favoriteIds: [],
      ui: <FavoriteButton listingId="listing-1" listingName="Blue Sparrow" />,
    });
    const saveBtn = screen.getByRole("button", { name: "Save Blue Sparrow" });
    expect(saveBtn).toHaveAttribute("aria-pressed", "false");

    cleanup();

    // Favorited: aria-pressed=true, "Saved — remove …" label.
    renderButton({
      signedIn: true,
      favoriteIds: ["listing-1"],
      ui: <FavoriteButton listingId="listing-1" listingName="Blue Sparrow" />,
    });
    const savedBtn = screen.getByRole("button", { name: "Saved — remove Blue Sparrow" });
    expect(savedBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("falls back to 'this spot' in the label when no name is given", () => {
    renderButton({
      signedIn: true,
      favoriteIds: [],
      ui: <FavoriteButton listingId="listing-1" />,
    });
    expect(screen.getByRole("button", { name: "Save this spot" })).toBeInTheDocument();
  });

  it("keeps its default browse-card styling when no className is given", () => {
    renderButton({
      signedIn: true,
      favoriteIds: [],
      ui: <FavoriteButton listingId="listing-1" listingName="Blue Sparrow" />,
    });
    const btn = screen.getByRole("button", { name: "Save Blue Sparrow" });
    // The default overlay chrome (absolute-positioned, translucent background)…
    expect(btn).toHaveClass("absolute", "right-3", "top-3", "bg-background/80");
    // …plus the always-kept disabled-while-pending utilities.
    expect(btn).toHaveClass("disabled:pointer-events-none", "disabled:opacity-60");
  });

  it("replaces the default chrome with a provided className (disabled utils kept)", () => {
    renderButton({
      signedIn: true,
      favoriteIds: [],
      ui: (
        <FavoriteButton
          listingId="listing-1"
          listingName="Blue Sparrow"
          className="size-10 rounded-full bg-black/50 text-white"
        />
      ),
    });
    const btn = screen.getByRole("button", { name: "Save Blue Sparrow" });
    // The caller's chrome is applied…
    expect(btn).toHaveClass("size-10", "bg-black/50", "text-white");
    // …and the default browse-card positioning/appearance is gone.
    expect(btn).not.toHaveClass("absolute", "right-3", "top-3", "bg-background/80");
    // The disabled-while-pending utilities survive the override.
    expect(btn).toHaveClass("disabled:pointer-events-none", "disabled:opacity-60");
  });
});
