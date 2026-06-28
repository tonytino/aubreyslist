import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the login-gated content-flag control (#39). The `submitFlag` server
 * function is mocked; we assert the anonymous gate (renders nothing), the
 * reason-input flow, the exclusive-arc target payload per surface, and the
 * success confirmation.
 */
const submitFlagMock = vi.fn((_args: unknown) => Promise.resolve());
vi.mock("~/server/flags/flags.fn", () => ({
  submitFlag: (args: unknown) => submitFlagMock(args),
}));

import { FlagControl } from "./FlagControl";

function renderWithQuery(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("FlagControl", () => {
  it("renders nothing for anonymous viewers (writes are login-gated)", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <FlagControl target="listing" listingId="listing-1" isSignedIn={false} />
      </QueryClientProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a Flag button for signed-in viewers with an accessible label", () => {
    renderWithQuery(<FlagControl target="listing" listingId="listing-1" isSignedIn={true} />);
    expect(screen.getByRole("button", { name: /flag/i })).toBeInTheDocument();
  });

  it("opens a reason input and submits a listing flag with the exclusive-arc target", async () => {
    renderWithQuery(<FlagControl target="listing" listingId="listing-1" isSignedIn={true} />);

    fireEvent.click(screen.getByRole("button", { name: /flag/i }));
    const textarea = screen.getByLabelText(/why are you flagging this/i);
    fireEvent.change(textarea, { target: { value: "Spam listing" } });
    fireEvent.click(screen.getByRole("button", { name: /submit flag/i }));

    await waitFor(() => {
      expect(submitFlagMock).toHaveBeenCalledTimes(1);
    });
    expect(submitFlagMock).toHaveBeenCalledWith({
      data: { target: "listing", listingId: "listing-1", reason: "Spam listing" },
    });
  });

  it("submits a claim flag with the claim target", async () => {
    renderWithQuery(<FlagControl target="claim" claimId="claim-1" isSignedIn={true} />);

    fireEvent.click(screen.getByRole("button", { name: /flag/i }));
    fireEvent.change(screen.getByLabelText(/why are you flagging this/i), {
      target: { value: "Wrong claim" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit flag/i }));

    await waitFor(() => {
      expect(submitFlagMock).toHaveBeenCalledWith({
        data: { target: "claim", claimId: "claim-1", reason: "Wrong claim" },
      });
    });
  });

  it("submits an incident flag with the incident target", async () => {
    renderWithQuery(<FlagControl target="incident" incidentId="incident-1" isSignedIn={true} />);

    fireEvent.click(screen.getByRole("button", { name: /flag/i }));
    fireEvent.change(screen.getByLabelText(/why are you flagging this/i), {
      target: { value: "Inappropriate" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit flag/i }));

    await waitFor(() => {
      expect(submitFlagMock).toHaveBeenCalledWith({
        data: { target: "incident", incidentId: "incident-1", reason: "Inappropriate" },
      });
    });
  });

  it("does not submit when the reason is empty (button disabled)", () => {
    renderWithQuery(<FlagControl target="listing" listingId="listing-1" isSignedIn={true} />);

    fireEvent.click(screen.getByRole("button", { name: /flag/i }));
    const submit = screen.getByRole("button", { name: /submit flag/i });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(submitFlagMock).not.toHaveBeenCalled();
  });

  it("shows a confirmation after a successful flag", async () => {
    renderWithQuery(<FlagControl target="listing" listingId="listing-1" isSignedIn={true} />);

    fireEvent.click(screen.getByRole("button", { name: /flag/i }));
    fireEvent.change(screen.getByLabelText(/why are you flagging this/i), {
      target: { value: "Spam" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit flag/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/reported/i);
  });
});
