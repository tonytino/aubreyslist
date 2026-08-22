import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the listing-detail hero place photo. The photos server fn is mocked;
 * asserted: the gradient fallback (renders nothing without a photo), the proxied
 * <img> for the first photo, the author attribution line (linked and unlinked,
 * joined with ", "), and the onError fallback back to nothing.
 */
const fetchListingPhotosMock = vi.fn((_args: unknown) => Promise.resolve<unknown>([]));
vi.mock("~/server/places-photos.fn", () => ({
  fetchListingPhotos: (args: unknown) => fetchListingPhotosMock(args),
}));

import {
  LISTING_PHOTOS_GC_TIME_MS,
  LISTING_PHOTOS_STALE_TIME_MS,
} from "~/components/listing/HeroPhoto";
import type { PlacePhoto } from "~/server/places-photos";
import { HERO_PHOTO_MAX_WIDTH_PX, HeroPhoto } from "./HeroPhoto";

const PHOTO: PlacePhoto = {
  photoToken: "places/ChIJ_place/photos/resource-1",
  widthPx: 4032,
  heightPx: 3024,
  attributions: [{ displayName: "A Diner", uri: "https://maps.google.com/maps/contrib/123" }],
};

const PREVIEW_SRC =
  "/api/places/photo?name=places%2FChIJ_place%2Fphotos%2Fresource-1&maxWidthPx=640";

function renderHero(listingId = "listing-1", previewSrc?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <HeroPhoto listingId={listingId} previewSrc={previewSrc} />
    </QueryClientProvider>
  );
  const rerenderHero = (nextListingId: string) =>
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <HeroPhoto listingId={nextListingId} previewSrc={previewSrc} />
      </QueryClientProvider>
    );
  return { ...view, rerenderHero };
}

/** The photo is decorative (alt=""), so it has no img role — query the node. */
function queryImg(container: HTMLElement) {
  return container.querySelector("img");
}

/** Both layers (preview underlay + full-res) render with alt="", so query by src. */
function queryImgBySrc(container: HTMLElement, src: string) {
  return container.querySelector(`img[src="${src}"]`);
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

  it("does not let a broken image on one listing suppress another listing's photo", async () => {
    // Client-side navigation can reuse the same component instance with a new
    // listingId (the route additionally remounts via key={listing.id}, but the
    // component must be safe either way): an onError on listing A's image is
    // scoped to that exact src and must not blank listing B's photo.
    const PHOTO_B = { ...PHOTO, photoToken: "places/ChIJ_other/photos/resource-9" };
    fetchListingPhotosMock.mockImplementation((args) => {
      const { listingId } = (args as { data: { listingId: string } }).data;
      return Promise.resolve(listingId === "listing-1" ? [PHOTO] : [PHOTO_B]);
    });

    const { container, rerenderHero } = renderHero("listing-1");
    const img = await waitFor(() => {
      const node = queryImg(container);
      expect(node).not.toBeNull();
      return node as HTMLImageElement;
    });

    fireEvent.error(img);
    await waitFor(() => expect(queryImg(container)).toBeNull());

    // Same instance, new listing → its (different) photo renders fine.
    rerenderHero("listing-2");
    const imgB = await waitFor(() => {
      const node = queryImg(container);
      expect(node).not.toBeNull();
      return node as HTMLImageElement;
    });
    expect(imgB.getAttribute("src")).toContain(encodeURIComponent(PHOTO_B.photoToken));

    // And navigating back to the broken listing stays suppressed (same src).
    rerenderHero("listing-1");
    await waitFor(() => expect(queryImg(container)).toBeNull());
  });
});

describe("HeroPhoto — blur-up preview (previewSrc)", () => {
  const FULL_SRC = `/api/places/photo?name=${encodeURIComponent(PHOTO.photoToken)}&maxWidthPx=${HERO_PHOTO_MAX_WIDTH_PX}`;

  it("renders the preview underlay immediately, before the photos query resolves", async () => {
    fetchListingPhotosMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderHero("listing-1", PREVIEW_SRC);

    const preview = queryImgBySrc(container, PREVIEW_SRC);
    expect(preview).not.toBeNull();
    expect(preview?.className).toContain("blur-[2px]");
    expect(preview?.className).toContain("scale-105");
  });

  it("fades the full-res photo in over the preview on load, keeping the preview mounted underneath", async () => {
    fetchListingPhotosMock.mockResolvedValue([PHOTO]);
    const { container } = renderHero("listing-1", PREVIEW_SRC);

    expect(queryImgBySrc(container, PREVIEW_SRC)).not.toBeNull();
    const fullRes = await waitFor(() => {
      const node = queryImgBySrc(container, FULL_SRC);
      expect(node).not.toBeNull();
      return node as HTMLImageElement;
    });
    expect(fullRes.className).toContain("opacity-0");
    expect(fullRes.className).toContain("transition-opacity");

    fireEvent.load(fullRes);

    await waitFor(() => expect(fullRes.className).toContain("opacity-100"));
    expect(fullRes.className).not.toContain("opacity-0");
    // The preview stays mounted (now fully covered) — no gap between the blur
    // fading out and the sharp photo fading in.
    expect(queryImgBySrc(container, PREVIEW_SRC)).not.toBeNull();
  });

  it("falls back to nothing — not the stale preview — when the full-res image fails", async () => {
    fetchListingPhotosMock.mockResolvedValue([PHOTO]);
    const { container } = renderHero("listing-1", PREVIEW_SRC);

    const fullRes = await waitFor(() => {
      const node = queryImgBySrc(container, FULL_SRC);
      expect(node).not.toBeNull();
      return node as HTMLImageElement;
    });

    fireEvent.error(fullRes);

    await waitFor(() => expect(queryImg(container)).toBeNull());
  });

  it("drops the preview once the query settles with no real photo", async () => {
    fetchListingPhotosMock.mockResolvedValue([]);
    const { container } = renderHero("listing-1", PREVIEW_SRC);

    expect(queryImgBySrc(container, PREVIEW_SRC)).not.toBeNull();
    await waitFor(() => expect(queryImg(container)).toBeNull());
  });

  it("renders unchanged (no preview layer, no transition classes) on a direct visit/refresh", async () => {
    fetchListingPhotosMock.mockResolvedValue([PHOTO]);
    const { container } = renderHero("listing-1");

    const img = await waitFor(() => {
      const node = queryImg(container);
      expect(node).not.toBeNull();
      return node as HTMLImageElement;
    });
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(img.className).not.toContain("opacity-0");
    expect(img.className).not.toContain("transition-opacity");
  });
});

describe("HeroPhoto — photo-ref query freshness", () => {
  it("pins the client staleTime/gcTime to the server-side 12h photo cache TTL", () => {
    const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
    expect(LISTING_PHOTOS_STALE_TIME_MS).toBe(TWELVE_HOURS_MS);
    expect(LISTING_PHOTOS_GC_TIME_MS).toBeGreaterThanOrEqual(LISTING_PHOTOS_STALE_TIME_MS);
  });
});
