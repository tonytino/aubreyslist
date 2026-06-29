import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the per-claim confirm/dispute/retract controls (#32 — a user
 * casting, CHANGING, or RETRACTING their OWN attestation). The attestation
 * server functions are mocked; we assert the gate, the change-vote and retract
 * calls, and that the claim roll-up query is invalidated so aggregates recompute.
 */
const submitVoteMock = vi.fn((_args: unknown) => Promise.resolve());
const removeVoteMock = vi.fn((_args: unknown) => Promise.resolve());
vi.mock("~/server/attestations/attestations.fn", () => ({
  submitVote: (args: unknown) => submitVoteMock(args),
  removeVote: (args: unknown) => removeVoteMock(args),
}));

import { ClaimVoteControls } from "./ClaimVoteControls";
import { claimsQueryKey } from "./CommunityClaims";

function renderWithQuery(ui: ReactElement): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return queryClient;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("ClaimVoteControls", () => {
  it("gates anonymous viewers with a sign-in prompt (no controls)", () => {
    renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="dedicated_fryer"
        claimId="claim-1"
        viewerVote={null}
        isSignedIn={false}
      />
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });

  it("casts a vote by (listingId, attribute) and invalidates the roll-up — even with no claim yet (#150)", async () => {
    // The lazy-create path: the attribute has no claim row (claimId null), yet
    // the viewer can still confirm it — the server creates the claim on first vote.
    const queryClient = renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="dedicated_fryer"
        claimId={null}
        viewerVote={null}
        isSignedIn={true}
      />
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(submitVoteMock).toHaveBeenCalledTimes(1);
    });
    expect(submitVoteMock).toHaveBeenCalledWith({
      data: { listingId: "listing-1", attribute: "dedicated_fryer", value: "confirm" },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: claimsQueryKey("listing-1") });
  });

  it("changes an existing vote (confirm → dispute) via the same upsert path", async () => {
    renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="dedicated_fryer"
        claimId="claim-1"
        viewerVote="confirm"
        isSignedIn={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Dispute" }));

    await waitFor(() => {
      expect(submitVoteMock).toHaveBeenCalledTimes(1);
    });
    expect(submitVoteMock).toHaveBeenCalledWith({
      data: { listingId: "listing-1", attribute: "dedicated_fryer", value: "dispute" },
    });
  });

  it("retracts the viewer's own vote by (listingId, attribute) and invalidates the roll-up", async () => {
    const queryClient = renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="dedicated_fryer"
        claimId="claim-1"
        viewerVote="confirm"
        isSignedIn={true}
      />
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByRole("button", { name: "Retract" }));

    await waitFor(() => {
      expect(removeVoteMock).toHaveBeenCalledTimes(1);
    });
    expect(removeVoteMock).toHaveBeenCalledWith({
      data: { listingId: "listing-1", attribute: "dedicated_fryer" },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: claimsQueryKey("listing-1") });
  });
});
