import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * AddListingWizard end-to-end tests. The create + vote server functions are
 * mocked. The load-bearing assertions:
 *
 *   - Submit creates the listing exactly ONCE.
 *   - `submitVote` fires ONLY for confirm/dispute answers — never for skip or
 *     untouched attributes (the "skip writes nothing" non-negotiable).
 *   - An all-skipped flow still creates the listing and fires ZERO votes.
 */
const createListingMock = vi.fn((_args: unknown) => Promise.resolve({} as never));
const submitVoteMock = vi.fn((_args: unknown) => Promise.resolve({} as never));
const autocompleteMock = vi.fn((_args: unknown) => Promise.resolve({ ok: true, data: [] }));
vi.mock("~/server/listings/create.fn", () => ({
  submitCreateListing: (args: unknown) => createListingMock(args),
}));
vi.mock("~/server/attestations/attestations.fn", () => ({
  submitVote: (args: unknown) => submitVoteMock(args),
}));
vi.mock("~/server/places.fn", () => ({
  autocompletePlaces: (args: unknown) => autocompleteMock(args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AddListingWizard } from "./AddListingWizard";

/** Mount the wizard inside an in-memory router (the success screen renders `<Link>`). */
function renderInApp(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => ui,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/listings/$id",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as unknown as never} />
    </QueryClientProvider>
  );
}

/** Fill the manual finder and advance past the selected-place card to step 1. */
async function pickPlaceManually() {
  fireEvent.change(await screen.findByLabelText("Restaurant name"), {
    target: { value: "Two Hands" },
  });
  fireEvent.change(screen.getByLabelText("Address"), { target: { value: "123 Main St" } });
  fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "39.7392" } });
  fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-104.9903" } });
  fireEvent.click(screen.getByRole("button", { name: /Use this place/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("AddListingWizard", () => {
  it("creates once and votes only for confirm/dispute answers (skips write nothing)", async () => {
    createListingMock.mockResolvedValueOnce({
      listing: { id: "l1" },
      created: true,
    } as never);
    renderInApp(<AddListingWizard intakeMode="manual" />);

    await pickPlaceManually();

    // Step 1 headline → confirm; 2 → skip; 3 → dispute; 4 → skip; 5 → confirm.
    fireEvent.click(await screen.findByRole("button", { name: /Confirm/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Skip \(not sure\)/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Dispute/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Skip \(not sure\)/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirm/ }));

    fireEvent.click(await screen.findByRole("button", { name: "Submit listing" }));

    await screen.findByText("Listing added, thanks!");

    expect(createListingMock).toHaveBeenCalledTimes(1);
    // Only the three attested attributes were voted — never the two skips.
    expect(submitVoteMock).toHaveBeenCalledTimes(3);
    const votes = submitVoteMock.mock.calls.map((call) => (call[0] as { data: unknown }).data);
    expect(votes).toEqual([
      { listingId: "l1", attribute: "celiac_safe_vs_gluten_friendly", value: "confirm" },
      { listingId: "l1", attribute: "dedicated_gf_menu", value: "dispute" },
      { listingId: "l1", attribute: "gf_substitutes", value: "confirm" },
    ]);
    // The success screen links to the created listing, not an auto-redirect.
    expect(screen.getByRole("link", { name: "View your listing" })).toBeInTheDocument();
  });

  it("submits filled typed links and drops blank fields (AUB-202)", async () => {
    createListingMock.mockResolvedValueOnce({
      listing: { id: "l5" },
      created: true,
    } as never);
    renderInApp(<AddListingWizard intakeMode="manual" />);

    // Fill the manual finder, then — on the selected-place card — two of the
    // five optional link fields. The other three stay blank.
    fireEvent.change(await screen.findByLabelText("Restaurant name"), {
      target: { value: "Two Hands" },
    });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "123 Main St" } });
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "39.7392" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-104.9903" } });
    fireEvent.click(screen.getByRole("button", { name: /Use this place/ }));

    fireEvent.change(await screen.findByLabelText("Menu", { exact: true }), {
      target: { value: "https://twohands.example/menu" },
    });
    fireEvent.change(screen.getByLabelText("Website", { exact: true }), {
      target: { value: "https://twohands.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(await screen.findByRole("button", { name: /Skip \(not sure\)/ }));
    }
    fireEvent.click(await screen.findByRole("button", { name: "Submit listing" }));
    await screen.findByText("Listing added, thanks!");

    // Only the two filled kinds are submitted — blanks are dropped, never sent.
    expect(createListingMock).toHaveBeenCalledWith({
      data: {
        mode: "manual",
        name: "Two Hands",
        address: "123 Main St",
        lat: 39.7392,
        lng: -104.9903,
        links: [
          { kind: "menu", url: "https://twohands.example/menu" },
          { kind: "website", url: "https://twohands.example" },
        ],
      },
    });
  });

  it("creates the listing and fires zero votes when every attribute is skipped", async () => {
    createListingMock.mockResolvedValueOnce({
      listing: { id: "l2" },
      created: true,
    } as never);
    renderInApp(<AddListingWizard intakeMode="manual" />);

    await pickPlaceManually();

    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(await screen.findByRole("button", { name: /Skip \(not sure\)/ }));
    }
    fireEvent.click(await screen.findByRole("button", { name: "Submit listing" }));

    await screen.findByText("Listing added, thanks!");

    expect(createListingMock).toHaveBeenCalledTimes(1);
    expect(submitVoteMock).not.toHaveBeenCalled();
    // Honest about the gap: all five stayed un-attested.
    expect(screen.getByText(/5 of 5 attributes stayed/)).toBeInTheDocument();
  });

  it("recovers a blocked manual duplicate with an inline existing-listing link", async () => {
    createListingMock.mockRejectedValueOnce(
      new Error(
        '"Two Hands" is already listed at this address. Open the existing listing instead of adding a duplicate. [[existing-listing:l9]]'
      )
    );
    renderInApp(<AddListingWizard intakeMode="manual" />);

    await pickPlaceManually();
    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(await screen.findByRole("button", { name: /Skip \(not sure\)/ }));
    }
    fireEvent.click(await screen.findByRole("button", { name: "Submit listing" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/already listed at this address/);
    expect(screen.getByRole("link", { name: /View the existing listing/ })).toBeInTheDocument();
    // No votes and no success on a blocked duplicate.
    expect(submitVoteMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Listing added, thanks!")).not.toBeInTheDocument();
  });

  it("resets to the start when 'Add another listing' is chosen", async () => {
    createListingMock.mockResolvedValueOnce({
      listing: { id: "l3" },
      created: true,
    } as never);
    renderInApp(<AddListingWizard intakeMode="manual" />);

    await pickPlaceManually();
    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(await screen.findByRole("button", { name: /Skip \(not sure\)/ }));
    }
    fireEvent.click(await screen.findByRole("button", { name: "Submit listing" }));
    await screen.findByText("Listing added, thanks!");

    fireEvent.click(screen.getByRole("button", { name: "Add another listing" }));

    // Back to step 0 with an empty manual finder (no place carried over).
    expect(await screen.findByLabelText("Restaurant name")).toHaveValue("");
    expect(screen.queryByText("Listing added, thanks!")).not.toBeInTheDocument();
  });

  it("is honest when the place already existed (created:false) and still records attestations", async () => {
    createListingMock.mockResolvedValueOnce({
      listing: { id: "l4" },
      created: false,
    } as never);
    renderInApp(<AddListingWizard intakeMode="manual" />);

    await pickPlaceManually();

    // Confirm the headline attribute, skip the rest, then submit.
    fireEvent.click(await screen.findByRole("button", { name: /Confirm/ }));
    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(await screen.findByRole("button", { name: /Skip \(not sure\)/ }));
    }
    fireEvent.click(await screen.findByRole("button", { name: "Submit listing" }));

    // No fabricated "added" — honest that it already existed, attestations kept.
    await screen.findByText("This place was already listed");
    expect(screen.queryByText("Listing added, thanks!")).not.toBeInTheDocument();
    expect(
      screen.getByText("We saved your attestations to the existing listing.")
    ).toBeInTheDocument();
    expect(submitVoteMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "View your listing" })).toBeInTheDocument();
  });
});
