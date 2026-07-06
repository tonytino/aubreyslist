import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ListingLink } from "~/db/schema";
import type { LinkKind } from "~/listings/links";

/**
 * ListingLinks tests (AUB-202): the detail page's Links section. Load-bearing
 * assertions:
 *
 *   - typed links render as external anchors in LINK_KINDS order,
 *   - a non-http(s) URL is suppressed at the render sink (#90 defence-in-depth),
 *   - a legacy `menuUrl` renders as the menu link when no menu-kind row exists,
 *   - the edit affordance is signed-in only (writes are re-gated server-side),
 *   - the edit dialog pre-fills, saves changed kinds, and removes cleared ones.
 */

const submitLinkMock = vi.fn((_args: unknown) => Promise.resolve({} as never));
const deleteLinkMock = vi.fn((_args: unknown) => Promise.resolve());
vi.mock("~/server/listing-links/links.fn", () => ({
  submitListingLink: (args: unknown) => submitLinkMock(args),
  deleteListingLink: (args: unknown) => deleteLinkMock(args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ListingLinks } from "./ListingLinks";

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function link(kind: LinkKind, url: string): ListingLink {
  return {
    id: `link-${kind}`,
    listingId: "listing-1",
    kind,
    url,
    createdBy: "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function baseProps() {
  return {
    listingId: "listing-1",
    mapsUrl: "https://maps.example.test/x",
    legacyMenuUrl: null,
    links: [] as ListingLink[],
    isSignedIn: false,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("ListingLinks — rendering", () => {
  it("renders typed links as new-tab anchors in LINK_KINDS order, after the Maps button", () => {
    renderWithQuery(
      <ListingLinks
        {...baseProps()}
        links={[
          // Deliberately out of order: render order comes from LINK_KINDS.
          link("website", "https://spot.example"),
          link("menu", "https://spot.example/menu"),
        ]}
      />
    );

    const section = screen.getByRole("region", { name: "Links" });
    const anchors = within(section).getAllByRole("link");
    expect(anchors.map((a) => a.textContent)).toEqual(["Open in Google Maps", "Menu", "Website"]);
    const menuAnchor = within(section).getByRole("link", { name: "Menu" });
    expect(menuAnchor).toHaveAttribute("href", "https://spot.example/menu");
    expect(menuAnchor).toHaveAttribute("target", "_blank");
    expect(menuAnchor).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("suppresses a non-http(s) URL at the render sink (#90 defence-in-depth)", () => {
    renderWithQuery(
      <ListingLinks
        {...baseProps()}
        mapsUrl="javascript:alert(1)"
        links={[
          link("menu", "javascript:alert(document.cookie)"),
          link("website", "https://spot.example"),
        ]}
      />
    );

    // Neither the dangerous maps URL nor the dangerous menu link renders.
    expect(screen.queryByRole("link", { name: "Open in Google Maps" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Menu" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Website" })).toBeInTheDocument();
  });

  it("falls back to the legacy menuUrl when there is no menu-kind link", () => {
    renderWithQuery(<ListingLinks {...baseProps()} legacyMenuUrl="https://legacy.example/menu" />);

    expect(screen.getByRole("link", { name: "Menu" })).toHaveAttribute(
      "href",
      "https://legacy.example/menu"
    );
  });

  it("prefers the typed menu link over the legacy menuUrl", () => {
    renderWithQuery(
      <ListingLinks
        {...baseProps()}
        legacyMenuUrl="https://legacy.example/menu"
        links={[link("menu", "https://typed.example/menu")]}
      />
    );

    expect(screen.getByRole("link", { name: "Menu" })).toHaveAttribute(
      "href",
      "https://typed.example/menu"
    );
  });

  it("shows the edit affordance only to signed-in viewers", () => {
    renderWithQuery(<ListingLinks {...baseProps()} isSignedIn={false} />);
    expect(screen.queryByRole("button", { name: /links/i })).not.toBeInTheDocument();
  });

  it("labels the affordance 'Add links' with no links and 'Edit links' with some", () => {
    renderWithQuery(<ListingLinks {...baseProps()} isSignedIn />);
    expect(screen.getByRole("button", { name: "Add links" })).toBeInTheDocument();
  });
});

describe("ListingLinks — edit dialog", () => {
  it("pre-fills the fields from current links (legacy menuUrl included) and saves changes", async () => {
    renderWithQuery(
      <ListingLinks
        {...baseProps()}
        isSignedIn
        legacyMenuUrl="https://legacy.example/menu"
        links={[link("website", "https://spot.example")]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit links" }));

    // Pre-filled: the stored website link and the legacy menu fallback.
    const menuField = await screen.findByLabelText("Menu", { exact: true });
    expect(menuField).toHaveValue("https://legacy.example/menu");
    expect(screen.getByLabelText("Website", { exact: true })).toHaveValue("https://spot.example");

    // Add a reservations link, then save.
    fireEvent.change(screen.getByLabelText("Reservations", { exact: true }), {
      target: { value: "https://book.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save links" }));

    await waitFor(() => {
      // Changed kinds are saved: the new reservations link AND the legacy menu
      // value (no typed menu row existed, so saving migrates it organically).
      expect(submitLinkMock).toHaveBeenCalledWith({
        data: { listingId: "listing-1", kind: "menu", url: "https://legacy.example/menu" },
      });
      expect(submitLinkMock).toHaveBeenCalledWith({
        data: { listingId: "listing-1", kind: "reservations", url: "https://book.example" },
      });
    });
    // The unchanged website link is NOT rewritten, and nothing is removed.
    expect(submitLinkMock).toHaveBeenCalledTimes(2);
    expect(deleteLinkMock).not.toHaveBeenCalled();
  });

  it("removes a cleared kind via deleteListingLink", async () => {
    renderWithQuery(
      <ListingLinks {...baseProps()} isSignedIn links={[link("website", "https://spot.example")]} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit links" }));
    fireEvent.change(await screen.findByLabelText("Website", { exact: true }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save links" }));

    await waitFor(() => {
      expect(deleteLinkMock).toHaveBeenCalledWith({
        data: { listingId: "listing-1", kind: "website" },
      });
    });
    expect(submitLinkMock).not.toHaveBeenCalled();
  });

  it("blocks a bad-scheme URL client-side with an inline error (no server call)", async () => {
    renderWithQuery(<ListingLinks {...baseProps()} isSignedIn />);

    fireEvent.click(screen.getByRole("button", { name: "Add links" }));
    fireEvent.change(await screen.findByLabelText("Website", { exact: true }), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save links" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/http:\/\/ or https:\/\//);
    expect(submitLinkMock).not.toHaveBeenCalled();
    expect(deleteLinkMock).not.toHaveBeenCalled();
  });
});
