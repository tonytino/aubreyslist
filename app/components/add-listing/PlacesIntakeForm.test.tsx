import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlacePrediction, PlacesResult } from "~/server/places";

/**
 * Component tests for the places intake form (issue #98). The Places server
 * functions are mocked — the test asserts the component's search-trigger
 * behaviour, not the real Google call. The QueryClient is configured with the
 * same non-zero `staleTime` the app uses in production (see app/router.tsx) so
 * the cache semantics under test match what users actually hit.
 */
const autocompleteMock = vi.fn(
  (_args: unknown): Promise<PlacesResult<PlacePrediction[]>> =>
    Promise.resolve({ ok: true, data: [] })
);
const createListingMock = vi.fn((_args: unknown) => Promise.resolve({} as never));
vi.mock("~/server/places", () => ({
  autocompletePlaces: (args: unknown) => autocompleteMock(args),
}));
vi.mock("~/server/listings/create", () => ({
  createListing: (args: unknown) => createListingMock(args),
}));

import { PlacesIntakeForm } from "./PlacesIntakeForm";

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    // Mirror production: a non-zero staleTime keeps a same-key query from
    // refetching, which is exactly the condition issue #98 exercises.
    defaultOptions: { queries: { staleTime: 60_000, retry: false } },
  });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function search(term: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: /Search for a restaurant/i }), {
    target: { value: term },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("PlacesIntakeForm", () => {
  it("runs an autocomplete search on submit", async () => {
    autocompleteMock.mockResolvedValueOnce({
      ok: true,
      data: [{ placeId: "p1", description: "Two Hands, Denver" }],
    });
    renderWithQuery(<PlacesIntakeForm onCreated={vi.fn()} />);

    search("Two Hands, Denver");

    await waitFor(() => expect(autocompleteMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Two Hands, Denver")).toBeInTheDocument();
  });

  it("re-runs the search when the same term is submitted again after a failure", async () => {
    // First attempt fails transiently; the UI tells the user to try again.
    autocompleteMock.mockResolvedValueOnce({
      ok: false,
      reason: "upstream_error",
      message: "Place search is temporarily unavailable. Please try again.",
    });
    renderWithQuery(<PlacesIntakeForm onCreated={vi.fn()} />);

    search("Two Hands, Denver");
    await waitFor(() => expect(autocompleteMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toHaveTextContent(/temporarily unavailable/i);

    // Second attempt with the SAME term must actually retry — otherwise the
    // "Please try again" affordance is dead (issue #98).
    autocompleteMock.mockResolvedValueOnce({
      ok: true,
      data: [{ placeId: "p1", description: "Two Hands, Denver" }],
    });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));

    await waitFor(() => expect(autocompleteMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Two Hands, Denver")).toBeInTheDocument();
  });
});
