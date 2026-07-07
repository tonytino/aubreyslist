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
 *   - the edit dialog pre-fills, saves changed kinds, and removes cleared ones —
 *     INCLUDING a cleared legacy-prefilled menu field, which must fire a real
 *     `deleteListingLink` (the server also clears the legacy column) and never
 *     silently no-op,
 *   - the links query is invalidated even when the mutation fails mid-sequence
 *     (earlier writes already committed — the page must refetch what landed),
 *   - the dialog's mobile full-screen layout (AUB-221): full-viewport base
 *     classes with sm: overrides restoring the centred dialog, and the
 *     header/actions pinned OUTSIDE the one internal scroll region (structure
 *     only — pixels are not assertable in jsdom).
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
  return { queryClient };
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
  it("pre-fills the fields from current links (legacy menuUrl included) and saves only changes", async () => {
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
      expect(submitLinkMock).toHaveBeenCalledWith({
        data: { listingId: "listing-1", kind: "reservations", url: "https://book.example" },
      });
    });
    // ONLY the changed kind is written: the untouched website row and the
    // untouched legacy menu value (its EFFECTIVE current value equals the
    // pre-fill) issue no writes, and nothing is removed.
    expect(submitLinkMock).toHaveBeenCalledTimes(1);
    expect(deleteLinkMock).not.toHaveBeenCalled();
  });

  it("saves an EDITED legacy-prefilled menu value as a typed link", async () => {
    renderWithQuery(
      <ListingLinks {...baseProps()} isSignedIn legacyMenuUrl="https://legacy.example/menu" />
    );

    // The legacy fallback renders a menu button, so the affordance reads Edit.
    fireEvent.click(screen.getByRole("button", { name: "Edit links" }));
    fireEvent.change(await screen.findByLabelText("Menu", { exact: true }), {
      target: { value: "https://fresh.example/menu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save links" }));

    await waitFor(() => {
      // The save is a typed menu write; the server clears the legacy column.
      expect(submitLinkMock).toHaveBeenCalledWith({
        data: { listingId: "listing-1", kind: "menu", url: "https://fresh.example/menu" },
      });
    });
    expect(deleteLinkMock).not.toHaveBeenCalled();
  });

  it("clearing a LEGACY-only menu field fires a real remove, never a silent no-op", async () => {
    // Case B of the legacy interplay: no typed menu row, only the legacy
    // column. Clearing the pre-filled field must issue deleteListingLink —
    // whose server side also nulls listings.menu_url — so the button actually
    // goes away after the refetch instead of a success toast over a no-op.
    renderWithQuery(
      <ListingLinks {...baseProps()} isSignedIn legacyMenuUrl="https://legacy.example/menu" />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit links" }));
    fireEvent.change(await screen.findByLabelText("Menu", { exact: true }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save links" }));

    await waitFor(() => {
      expect(deleteLinkMock).toHaveBeenCalledWith({
        data: { listingId: "listing-1", kind: "menu" },
      });
    });
    expect(submitLinkMock).not.toHaveBeenCalled();
  });

  it("clearing the menu field removes the typed row even when a legacy value also exists", async () => {
    // Case A of the legacy interplay (post-backfill rows): typed menu row AND
    // a lingering legacy column value. The remove fires for the menu kind; the
    // server deletes the row AND clears the legacy column, and because the
    // legacy fallback is served by the same invalidated links query, the
    // refetch cannot resurrect the button.
    renderWithQuery(
      <ListingLinks
        {...baseProps()}
        isSignedIn
        legacyMenuUrl="https://legacy.example/menu"
        links={[link("menu", "https://typed.example/menu")]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit links" }));
    fireEvent.change(await screen.findByLabelText("Menu", { exact: true }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save links" }));

    await waitFor(() => {
      expect(deleteLinkMock).toHaveBeenCalledWith({
        data: { listingId: "listing-1", kind: "menu" },
      });
    });
    expect(submitLinkMock).not.toHaveBeenCalled();
  });

  it("invalidates the links query even when the mutation fails mid-sequence", async () => {
    // Two changed kinds: the first save succeeds (committed server-side), the
    // second fails. onSettled must still invalidate so the page refetches the
    // partially-applied state instead of showing stale buttons.
    submitLinkMock
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error("boom") as never);
    const { queryClient } = renderWithQuery(<ListingLinks {...baseProps()} isSignedIn />);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByRole("button", { name: "Add links" }));
    fireEvent.change(await screen.findByLabelText("Menu", { exact: true }), {
      target: { value: "https://a.example/menu" },
    });
    fireEvent.change(screen.getByLabelText("Website", { exact: true }), {
      target: { value: "https://a.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save links" }));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["listing-links", "listing-1"],
      });
    });
    expect(submitLinkMock).toHaveBeenCalledTimes(2);
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

  it("is a full-screen takeover on mobile, restored to a capped centred dialog at sm+", async () => {
    renderWithQuery(<ListingLinks {...baseProps()} isSignedIn />);

    fireEvent.click(screen.getByRole("button", { name: "Add links" }));
    const dialog = await screen.findByRole("dialog");

    // Mobile base = full viewport (dvh for browser chrome) and square corners;
    // sm: overrides restore the centred, height-capped dialog. Class-level
    // assertions only — jsdom cannot measure the result.
    for (const cls of ["h-dvh", "max-w-none", "rounded-none", "top-0", "left-0"]) {
      expect(dialog).toHaveClass(cls);
    }
    for (const cls of ["sm:h-auto", "sm:max-h-[85dvh]", "sm:max-w-lg", "sm:rounded-lg"]) {
      expect(dialog).toHaveClass(cls);
    }
    // The primitive's centred positioning must actually be overridden (the
    // tailwind-merge conflict resolution is load-bearing here).
    expect(dialog.className).not.toMatch(/(?:^|\s)top-\[50%\]/);
    expect(dialog).toHaveClass("translate-x-0");
  });

  it("keeps the title and actions outside the ONE internal scroll region", async () => {
    renderWithQuery(<ListingLinks {...baseProps()} isSignedIn />);

    fireEvent.click(screen.getByRole("button", { name: "Add links" }));
    const dialog = await screen.findByRole("dialog");

    const scrollRegions = dialog.querySelectorAll(".overflow-y-auto");
    expect(scrollRegions).toHaveLength(1);
    const scrollRegion = scrollRegions[0] as HTMLElement;

    // The fields scroll; the header and the save/cancel actions never do.
    expect(scrollRegion).toContainElement(screen.getByLabelText("Menu", { exact: true }));
    expect(scrollRegion).not.toContainElement(
      screen.getByText("Add or fix this restaurant's links. Anyone signed in can edit them.")
    );
    expect(scrollRegion).not.toContainElement(screen.getByRole("button", { name: "Save links" }));
    expect(scrollRegion).not.toContainElement(screen.getByRole("button", { name: "Cancel" }));
    // a11y wiring survives the restructure: the dialog is labelled by the
    // title and described by the description.
    expect(dialog).toHaveAccessibleName("Add links");
    expect(dialog).toHaveAccessibleDescription(
      "Add or fix this restaurant's links. Anyone signed in can edit them."
    );
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
