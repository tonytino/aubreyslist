import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the FavoriteButton island. The favorite/unfavorite server functions
 * and the toast are mocked; asserted: the anonymous gate opens the dialog with no
 * write, the signed-in optimistic toggle (cache flips immediately on and off), the
 * error rollback (+ toast), and the a11y attributes.
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
import { cn } from "~/lib/utils";
import type { SessionUser } from "~/server/auth/current-user.fn";
import { FAVORITE_HERO_CHROME, FavoriteButton } from "./FavoriteButton";

/** The disabled-while-pending utilities the component always keeps. */
const DISABLED_UTILS = "disabled:pointer-events-none disabled:opacity-60";

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

    // ...and crucially no favorite/unfavorite write was attempted.
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
    expect(screen.getByRole("button", { name: /saved, remove blue sparrow/i })).toHaveAttribute(
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

    fireEvent.click(screen.getByRole("button", { name: /saved, remove blue sparrow/i }));

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

    // Favorited: aria-pressed=true, "Saved, remove …" label.
    renderButton({
      signedIn: true,
      favoriteIds: ["listing-1"],
      ui: <FavoriteButton listingId="listing-1" listingName="Blue Sparrow" />,
    });
    const savedBtn = screen.getByRole("button", { name: "Saved, remove Blue Sparrow" });
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

/**
 * One control carries both the diner's save action and the public save count: a
 * circle with no count, a same-height pill with one. The count is honoured only
 * on the default chrome — a caller's own chrome sizes for a bare glyph, so the
 * count leaves the render and the accessible name together.
 */
describe("FavoriteButton — merged save count", () => {
  it("stays a plain circle with no count, and with a zero count", () => {
    for (const saveCount of [undefined, 0]) {
      renderButton({
        signedIn: true,
        favoriteIds: [],
        ui: (
          <FavoriteButton listingId="listing-1" listingName="Blue Sparrow" saveCount={saveCount} />
        ),
      });
      // No fabricated "0 saves", nothing added to the name.
      expect(screen.queryByTestId("save-count")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save Blue Sparrow" })).toBeInTheDocument();
      cleanup();
    }
  });

  it("widens into a pill carrying heart + number, with no visible 'saves' word", () => {
    renderButton({
      signedIn: true,
      favoriteIds: [],
      ui: <FavoriteButton listingId="listing-1" listingName="Blue Sparrow" saveCount={24} />,
    });
    const btn = screen.getByRole("button", { name: /^Save Blue Sparrow/ });
    expect(within(btn).getByTestId("save-count")).toHaveTextContent("24");
    expect(btn).not.toHaveTextContent("saves");
    // Same 36px height as the circle, grown sideways — the media tile's right
    // rail must hold still whether or not a card is counted.
    expect(btn).toHaveClass("h-9", "min-w-9", "px-2.5");
    // The house focus ring, like every neighbouring control.
    expect(btn).toHaveClass("focus-visible:ring-2", "focus-visible:ring-brand-ring");
  });

  it("tints the SAVED heart brand on the overlay chrome, on the glyph not the button", () => {
    renderButton({
      signedIn: true,
      favoriteIds: ["listing-1"],
      ui: <FavoriteButton listingId="listing-1" listingName="Blue Sparrow" saveCount={24} />,
    });
    const btn = screen.getByRole("button", { name: /^Saved, remove Blue Sparrow/ });
    const heart = btn.querySelector("svg") as SVGElement;
    // The colour rides on the glyph, so the button's `hover:text-brand` cannot
    // repaint a saved heart mid-hover.
    expect(heart.getAttribute("class")).toContain("text-brand-strong");
    expect(heart.getAttribute("class")).toContain("fill-current");
    // Redundant with the state carriers that do not depend on sight.
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("leaves the saved heart's colour to a caller that owns the chrome", () => {
    // Free-form chrome brings its own palette, so the fill inherits rather than
    // dropping a surface ink onto a backdrop nobody checked.
    renderButton({
      signedIn: true,
      favoriteIds: ["listing-1"],
      ui: (
        <FavoriteButton
          listingId="listing-1"
          listingName="Blue Sparrow"
          className="size-10 rounded-full bg-black/50 text-white"
        />
      ),
    });
    const heart = screen.getByRole("button", { name: /^Saved, remove/ }).querySelector("svg");
    expect(heart?.getAttribute("class")).toContain("fill-current");
    expect(heart?.getAttribute("class")).not.toContain("text-brand-strong");
    expect(heart?.getAttribute("class")).not.toContain("text-accent-lavender");
  });

  it("folds the count into the accessible name, both directions", () => {
    renderButton({
      signedIn: true,
      favoriteIds: [],
      ui: <FavoriteButton listingId="listing-1" listingName="Blue Sparrow" saveCount={24} />,
    });
    // Personal action first, community count second — two statements.
    expect(screen.getByRole("button", { name: "Save Blue Sparrow. 24 saves" })).toBeInTheDocument();

    cleanup();

    renderButton({
      signedIn: true,
      favoriteIds: ["listing-1"],
      ui: <FavoriteButton listingId="listing-1" listingName="Blue Sparrow" saveCount={24} />,
    });
    expect(
      screen.getByRole("button", { name: "Saved, remove Blue Sparrow. 24 saves" })
    ).toBeInTheDocument();
  });

  it("says '1 save', not '1 saves'", () => {
    renderButton({
      signedIn: true,
      favoriteIds: [],
      ui: <FavoriteButton listingId="listing-1" listingName="Blue Sparrow" saveCount={1} />,
    });
    expect(screen.getByRole("button", { name: "Save Blue Sparrow. 1 save" })).toBeInTheDocument();
  });

  it("carries the ADR-007 'not a safety score' tooltip only when counted", async () => {
    renderButton({
      signedIn: true,
      favoriteIds: [],
      ui: <FavoriteButton listingId="listing-1" listingName="Blue Sparrow" saveCount={24} />,
    });
    fireEvent.focus(screen.getByRole("button", { name: /^Save Blue Sparrow/ }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Community saves, not a safety score."
    );
  });

  it("still toggles the save when the count is showing", async () => {
    const queryClient = renderButton({
      signedIn: true,
      favoriteIds: [],
      ui: <FavoriteButton listingId="listing-1" listingName="Blue Sparrow" saveCount={24} />,
    });
    // The tooltip wrapper must not swallow the click that is the button's whole job.
    fireEvent.click(screen.getByRole("button", { name: /^Save Blue Sparrow/ }));
    await waitFor(() =>
      expect(queryClient.getQueryData(favoriteIdsQuery.queryKey)).toEqual(["listing-1"])
    );
    expect(favoriteListingMock).toHaveBeenCalledWith({ data: { listingId: "listing-1" } });
  });

  it("drops the count from BOTH the render and the name on caller-owned chrome", () => {
    // A free-form box cannot promise room for a number or contrast for its ink.
    // An announced count with nothing on screen is its own defect, so the two
    // are suppressed together. A surface that wants a count earns a named entry.
    renderButton({
      signedIn: true,
      favoriteIds: [],
      ui: (
        <FavoriteButton
          listingId="listing-1"
          listingName="Blue Sparrow"
          saveCount={24}
          className="size-10 rounded-full"
        />
      ),
    });
    expect(screen.queryByTestId("save-count")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Blue Sparrow" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /24 saves/ })).not.toBeInTheDocument();
  });
});

/**
 * The listing hero's icon rail. Same counted-pill treatment as the cards, on a
 * chip pinned dark in both themes — so the box, the ink, and the count's own
 * contrast are the surface's, not the card's.
 */
describe("FavoriteButton — hero surface", () => {
  const hero = (props: { saveCount?: number } = {}) => (
    <FavoriteButton
      listingId="listing-1"
      listingName="Blue Sparrow"
      surface="hero"
      {...(props.saveCount !== undefined ? { saveCount: props.saveCount } : {})}
    />
  );

  it("draws the shared rail chip, so the heart and the flag control match", () => {
    renderButton({ signedIn: true, favoriteIds: [], ui: hero() });
    const btn = screen.getByRole("button", { name: "Save Blue Sparrow" });
    expect(btn.className).toBe(cn(FAVORITE_HERO_CHROME, DISABLED_UTILS));
    // Not the card overlay: the rail is not absolutely positioned on a tile.
    expect(btn.className).not.toContain("absolute");
  });

  it("counts on the hero, with the count in the accessible name both directions", () => {
    renderButton({ signedIn: true, favoriteIds: [], ui: hero({ saveCount: 24 }) });
    const btn = screen.getByRole("button", { name: "Save Blue Sparrow. 24 saves" });
    expect(within(btn).getByTestId("save-count")).toHaveTextContent("24");
    // The chip grows sideways from the same 40px height the flag control keeps.
    expect(btn).toHaveClass("h-10", "min-w-10", "px-3");

    cleanup();

    renderButton({ signedIn: true, favoriteIds: ["listing-1"], ui: hero({ saveCount: 24 }) });
    expect(
      screen.getByRole("button", { name: "Saved, remove Blue Sparrow. 24 saves" })
    ).toBeInTheDocument();
  });

  it("stays a bare circle at zero and when no count is supplied", () => {
    for (const saveCount of [undefined, 0]) {
      renderButton({
        signedIn: true,
        favoriteIds: [],
        ui: hero({ ...(saveCount !== undefined ? { saveCount } : {}) }),
      });
      expect(screen.queryByTestId("save-count")).not.toBeInTheDocument();
      const btn = screen.getByRole("button", { name: "Save Blue Sparrow" });
      expect(btn.className).not.toContain("px-3");
      cleanup();
    }
  });

  it("tints the saved heart with the rail's own light brand ink", async () => {
    // The rail is pinned dark in both themes, so its saved ink is pinned light:
    // `brand-strong` would fall under 2.4:1 on this chip.
    renderButton({ signedIn: true, favoriteIds: ["listing-1"], ui: hero({ saveCount: 24 }) });
    const btn = screen.getByRole("button", { name: /^Saved, remove/ });
    const heart = btn.querySelector("svg") as SVGElement;
    expect(heart.getAttribute("class")).toContain("text-accent-lavender");
    expect(heart.getAttribute("class")).not.toContain("text-brand-strong");
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("carries the same ADR-007 tooltip as the cards", async () => {
    renderButton({ signedIn: true, favoriteIds: [], ui: hero({ saveCount: 24 }) });
    fireEvent.focus(screen.getByRole("button", { name: /^Save Blue Sparrow/ }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Community saves, not a safety score."
    );
  });

  it("adds no tooltip to an uncounted hero heart", () => {
    renderButton({ signedIn: true, favoriteIds: [], ui: hero() });
    fireEvent.focus(screen.getByRole("button", { name: "Save Blue Sparrow" }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
