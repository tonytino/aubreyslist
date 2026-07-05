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

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";

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
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Vote recorded");
    });
  });

  it("shows an error toast when casting a vote fails", async () => {
    submitVoteMock.mockRejectedValueOnce(new Error("boom"));
    renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="dedicated_fryer"
        claimId="claim-1"
        viewerVote={null}
        isSignedIn={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Could not record your vote. Please try again.");
    });
    expect(toast.success).not.toHaveBeenCalled();
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

  it("iconises confirm/dispute and maps the pressed vote to the safety-colour fills (AUB-131)", () => {
    renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="dedicated_fryer"
        claimId="claim-1"
        viewerVote="confirm"
        isSignedIn={true}
      />
    );
    const confirm = screen.getByRole("button", { name: "Confirm" });
    const dispute = screen.getByRole("button", { name: "Dispute" });
    // Each control carries a lucide glyph alongside its text label (never icon-only).
    expect(confirm.querySelector("svg")).not.toBeNull();
    expect(dispute.querySelector("svg")).not.toBeNull();
    // The viewer's own confirm is filled with the celiac-safe colour; the
    // unpressed dispute is not filled with the incident colour.
    expect(confirm).toHaveAttribute("aria-pressed", "true");
    expect(confirm.className).toContain("bg-celiac-safe");
    expect(dispute).toHaveAttribute("aria-pressed", "false");
    expect(dispute.className).not.toContain("bg-incident");
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
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Vote retracted");
    });
  });

  it("shows an error toast when retracting a vote fails", async () => {
    removeVoteMock.mockRejectedValueOnce(new Error("boom"));
    renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="dedicated_fryer"
        claimId="claim-1"
        viewerVote="confirm"
        isSignedIn={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Retract" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Could not retract your vote. Please try again.");
    });
    expect(toast.success).not.toHaveBeenCalled();
  });
});
