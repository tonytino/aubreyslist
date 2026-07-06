import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the listing-detail hero place photo (AUB-215). The photos server fn
 * is mocked; we assert the gradient fallback (renders NOTHING without a photo),
 * the proxied <img> for the first photo, the author attribution line (linked
 * and unlinked, joined with ", "), and the onError fallback back to nothing.
 */
const fetchListingPhotosMock = vi.fn((_args: unknown) => Promise.resolve<unknown>([]));
vi.mock("~/server/places-photos.fn", () => ({
  fetchListingPhotos: (args: unknown) => fetchListingPhotosMock(args),
}));

import type { PlacePhoto } from "~/server/places-photos";
import { HERO_PHOTO_MAX_WIDTH_PX, HeroPhoto } from "./HeroPhoto";

const PHOTO: PlacePhoto = {
  photoToken: "places/ChIJ_place/photos/resource-1",
  widthPx: 4032,
  heightPx: 3024,
  attributions: [{ displayName: "A Diner", uri: "https://maps.google.com/maps/contrib/123" }],
};

function renderHero() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <HeroPhoto listingId="listing-1" />
    </QueryClientProvider>
  );
}

/** The photo is decorative (alt=""), so it has no img role — query the node. */
function queryImg(container: HTMLElement) {
  return container.querySelector("img");
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("HeroPhoto", () => {
  it("renders nothing when no photo comes back (gradient fallback shows through)", async () => {
    fetchListingPhotosMock.mockResolvedValue([]);
    const { container } = renderHero();

    await waitFor(() => expect(fetchListingPhotosMock).toHaveBeenCalledTimes(1));
    expect(fetchListingPhotosMock).toHaveBeenCalledWith({ data: { listingId: "listing-1" } });
    expect(queryImg(container)).toBeNull();
    expect(screen.queryByText(/photo:/i)).not.toBeInTheDocument();
  });

  it("renders nothing when the query errors (photos never break the page)", async () => {
    fetchListingPhotosMock.mockRejectedValue(new Error("boom"));
    const { container } = renderHero();

    await waitFor(() => expect(fetchListingPhotosMock).toHaveBeenCalled());
    expect(queryImg(container)).toBeNull();
  });

  it("renders the FIRST photo through the media proxy, decorative and lazy", async () => {
    fetchListingPhotosMock.mockResolvedValue([
      PHOTO,
      { ...PHOTO, photoToken: "places/ChIJ_place/photos/resource-2" },
    ]);
    const { container } = renderHero();

    const img = await waitFor(() => {
      const node = queryImg(container);
      expect(node).not.toBeNull();
      return node as HTMLImageElement;
    });

    // Proxy URL (token encoded) at the hero width — never a googleapis URL or key.
    expect(img).toHaveAttribute(
      "src",
      `/api/places/photo?name=${encodeURIComponent(PHOTO.photoToken)}&maxWidthPx=${HERO_PHOTO_MAX_WIDTH_PX}`
    );
    expect(img.getAttribute("src")).not.toContain("resource-2"); // first photo only
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("credits the photo author with a safe external link", async () => {
    fetchListingPhotosMock.mockResolvedValue([PHOTO]);
    renderHero();

    const link = await screen.findByRole("link", { name: "A Diner" });
    expect(link).toHaveAttribute("href", "https://maps.google.com/maps/contrib/123");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/photo:/i)).toBeInTheDocument();
  });

  it("joins multiple attributions with ', ' and renders link-less authors as text", async () => {
    fetchListingPhotosMock.mockResolvedValue([
      {
        ...PHOTO,
        attributions: [
          { displayName: "A Diner", uri: "https://maps.google.com/maps/contrib/123" },
          { displayName: "B Baker" },
        ],
      },
    ]);
    renderHero();

    const credit = await screen.findByText(/photo:/i);
    expect(credit).toHaveTextContent("Photo: A Diner, B Baker");
    expect(screen.getByRole("link", { name: "A Diner" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "B Baker" })).not.toBeInTheDocument();
  });

  it("omits the attribution line entirely when the photo carries no attributions", async () => {
    fetchListingPhotosMock.mockResolvedValue([{ ...PHOTO, attributions: [] }]);
    const { container } = renderHero();

    await waitFor(() => expect(queryImg(container)).not.toBeNull());
    expect(screen.queryByText(/photo:/i)).not.toBeInTheDocument();
  });

  it("falls back to nothing (gradient + no credit) when the image fails to load", async () => {
    fetchListingPhotosMock.mockResolvedValue([PHOTO]);
    const { container } = renderHero();

    const img = await waitFor(() => {
      const node = queryImg(container);
      expect(node).not.toBeNull();
      return node as HTMLImageElement;
    });

    fireEvent.error(img);

    await waitFor(() => expect(queryImg(container)).toBeNull());
    expect(screen.queryByText(/photo:/i)).not.toBeInTheDocument();
  });
});
