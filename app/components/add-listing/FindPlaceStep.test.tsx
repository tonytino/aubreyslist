import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlacePrediction, PlacesResult } from "~/listings/places-input";
import type { WizardPlace } from "./AddListingWizard";

/**
 * FindPlaceStep tests: it COLLECTS a place (Places pick or manual entry) via
 * onSelect and NEVER creates a listing itself (submitCreateListing is not even
 * imported here — the create is deferred to the wizard's final submit). Also
 * covers the selected-place card's Change / Continue affordances.
 */
const autocompleteMock = vi.fn(
  (_args: unknown): Promise<PlacesResult<PlacePrediction[]>> =>
    Promise.resolve({ ok: true, data: [] })
);
vi.mock("~/server/places.fn", () => ({
  autocompletePlaces: (args: unknown) => autocompleteMock(args),
}));

import { FindPlaceStep } from "./FindPlaceStep";

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, retry: false } },
  });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function baseProps() {
  return {
    intakeMode: "places" as const,
    place: null,
    menuUrl: "",
    onMenuUrlChange: vi.fn(),
    onSelect: vi.fn(),
    onClear: vi.fn(),
    onContinue: vi.fn(),
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("FindPlaceStep", () => {
  it("collects a Places pick via onSelect (no create)", async () => {
    autocompleteMock.mockResolvedValueOnce({
      ok: true,
      data: [{ placeId: "p1", description: "Two Hands, Denver" }],
    });
    const props = baseProps();
    renderWithQuery(<FindPlaceStep {...props} />);

    fireEvent.change(screen.getByRole("searchbox", { name: /Search for a restaurant/ }), {
      target: { value: "Two Hands" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));

    fireEvent.click(await screen.findByText("Two Hands, Denver"));
    expect(props.onSelect).toHaveBeenCalledWith({
      mode: "places",
      placeId: "p1",
      description: "Two Hands, Denver",
    });
  });

  it("collects a manual entry via the 'enter manually' toggle", () => {
    const props = baseProps();
    renderWithQuery(<FindPlaceStep {...props} />);

    fireEvent.click(screen.getByRole("button", { name: /Enter manually instead/ }));
    fireEvent.change(screen.getByLabelText("Restaurant name"), {
      target: { value: "Two Hands" },
    });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "123 Main St" } });
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "39.7392" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-104.9903" } });
    fireEvent.click(screen.getByRole("button", { name: /Use this place/ }));

    expect(props.onSelect).toHaveBeenCalledWith({
      mode: "manual",
      name: "Two Hands",
      address: "123 Main St",
      lat: 39.7392,
      lng: -104.9903,
    });
  });

  it("renders the manual form directly when intake is manual", () => {
    const props = { ...baseProps(), intakeMode: "manual" as const };
    renderWithQuery(<FindPlaceStep {...props} />);
    // No Places search box in manual intake mode.
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Restaurant name")).toBeInTheDocument();
  });

  it("shows the selected-place card with Change and Continue", () => {
    const place: WizardPlace = { mode: "places", placeId: "p1", description: "Two Hands, Denver" };
    const props = { ...baseProps(), place };
    renderWithQuery(<FindPlaceStep {...props} />);

    expect(screen.getByText("Two Hands, Denver")).toBeInTheDocument();
    expect(screen.getByText(/dedup by Place ID/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(props.onContinue).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });
});
