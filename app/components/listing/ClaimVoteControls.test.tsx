import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the per-claim badge toggle controls (#32 — a user casting,
 * CHANGING, or RETRACTING their OWN attestation; owner feedback: the two
 * buttons are toggles and present as the claim's badge). The attestation
 * server functions are mocked; we assert the gate, the toggle semantics
 * (press again = retract, press the other side = switch), the badge
 * presentation per attribute, and that the claim roll-up query is invalidated
 * so aggregates recompute.
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
        viewerVote={null}
        isSignedIn={false}
      />
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("casts a vote by (listingId, attribute) and invalidates the roll-up — even with no claim yet (#150)", async () => {
    // The lazy-create path: the attribute may have no claim row, yet the viewer
    // can still confirm it — the server creates the claim on first vote.
    const queryClient = renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="dedicated_fryer"
        viewerVote={null}
        isSignedIn={true}
      />
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    // The confirm affordance IS the attribute's badge, not a generic "Confirm".
    fireEvent.click(screen.getByRole("button", { name: "Dedicated fryer" }));

    await waitFor(() => {
      expect(submitVoteMock).toHaveBeenCalledTimes(1);
    });
    expect(submitVoteMock).toHaveBeenCalledWith({
      data: { listingId: "listing-1", attribute: "dedicated_fryer", value: "confirm" },
    });
    expect(removeVoteMock).not.toHaveBeenCalled();
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
        viewerVote={null}
        isSignedIn={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Dedicated fryer" }));

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
    expect(removeVoteMock).not.toHaveBeenCalled();
  });

  it("retracts by pressing the viewer's CURRENT vote again — there is no Retract link", async () => {
    const queryClient = renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="dedicated_fryer"
        viewerVote="confirm"
        isSignedIn={true}
      />
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    // No separate retract affordance anywhere.
    expect(screen.queryByRole("button", { name: "Retract" })).not.toBeInTheDocument();

    // Pressing the already-pressed confirm badge toggles the vote off.
    fireEvent.click(screen.getByRole("button", { name: "Dedicated fryer" }));

    await waitFor(() => {
      expect(removeVoteMock).toHaveBeenCalledTimes(1);
    });
    expect(removeVoteMock).toHaveBeenCalledWith({
      data: { listingId: "listing-1", attribute: "dedicated_fryer" },
    });
    expect(submitVoteMock).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: claimsQueryKey("listing-1") });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Vote retracted");
    });
  });

  it("retracts a dispute by pressing the pressed dispute badge again", async () => {
    renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="dedicated_fryer"
        viewerVote="dispute"
        isSignedIn={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Dispute" }));

    await waitFor(() => {
      expect(removeVoteMock).toHaveBeenCalledTimes(1);
    });
    expect(removeVoteMock).toHaveBeenCalledWith({
      data: { listingId: "listing-1", attribute: "dedicated_fryer" },
    });
    expect(submitVoteMock).not.toHaveBeenCalled();
  });

  it("shows an error toast when retracting a vote fails", async () => {
    removeVoteMock.mockRejectedValueOnce(new Error("boom"));
    renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="dedicated_fryer"
        viewerVote="confirm"
        isSignedIn={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Dedicated fryer" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Could not retract your vote. Please try again.");
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("presents the headline claim as Celiac-safe / Gluten-friendly badge toggles", () => {
    renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="celiac_safe_vs_gluten_friendly"
        viewerVote="confirm"
        isSignedIn={true}
      />
    );
    const confirm = screen.getByRole("button", { name: "Celiac-safe" });
    const dispute = screen.getByRole("button", { name: "Gluten-friendly" });
    // Icon + visible text label on both — meaning never rests on colour alone.
    expect(confirm.querySelector("svg")).not.toBeNull();
    expect(dispute.querySelector("svg")).not.toBeNull();
    // The viewer's own confirm is filled with the celiac-safe colour; the
    // unpressed gluten-friendly side stays a neutral outline badge.
    expect(confirm).toHaveAttribute("aria-pressed", "true");
    expect(confirm.className).toContain("bg-celiac-safe");
    expect(dispute).toHaveAttribute("aria-pressed", "false");
    expect(dispute.className).not.toContain("bg-gluten-friendly");
  });

  it("fills a pressed headline dispute with the gluten-friendly colour", () => {
    renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="celiac_safe_vs_gluten_friendly"
        viewerVote="dispute"
        isSignedIn={true}
      />
    );
    const dispute = screen.getByRole("button", { name: "Gluten-friendly" });
    expect(dispute).toHaveAttribute("aria-pressed", "true");
    expect(dispute.className).toContain("bg-gluten-friendly");
  });

  it("presents a non-headline claim as its attribute badge + a consistent Dispute badge", () => {
    renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="dedicated_gf_menu"
        viewerVote="dispute"
        isSignedIn={true}
      />
    );
    // Confirm = the attribute's own badge (icon + label from the taxonomy maps).
    const confirm = screen.getByRole("button", { name: "Dedicated GF menu" });
    const dispute = screen.getByRole("button", { name: "Dispute" });
    expect(confirm.querySelector("svg")).not.toBeNull();
    expect(dispute.querySelector("svg")).not.toBeNull();
    // The viewer's own dispute is pressed and filled; the confirm badge is not.
    expect(dispute).toHaveAttribute("aria-pressed", "true");
    expect(dispute.className).toContain("bg-incident");
    expect(confirm).toHaveAttribute("aria-pressed", "false");
    expect(confirm.className).not.toContain("bg-celiac-safe");
  });

  it("shows a visible ownership caption for the viewer's own vote, and none without one", () => {
    renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="dedicated_fryer"
        viewerVote="confirm"
        isSignedIn={true}
      />
    );
    // The pressed badge shares SafetySignal's badge language, so a visible text
    // cue distinguishes "your vote" from a community verdict chip (ADR-007).
    expect(screen.getByText("You confirmed this.")).toBeInTheDocument();
    cleanup();

    renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="dedicated_fryer"
        viewerVote={null}
        isSignedIn={true}
      />
    );
    expect(screen.queryByText("You confirmed this.")).not.toBeInTheDocument();
    expect(screen.queryByText("You disputed this.")).not.toBeInTheDocument();
  });

  it("keeps the plain confirm/dispute caption wording for a NON-headline attribute", () => {
    // A plain attribute like "Dedicated fryer" reads fine as confirmed/disputed.
    renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="dedicated_fryer"
        viewerVote="dispute"
        isSignedIn={true}
      />
    );
    expect(screen.getByText("You disputed this.")).toBeInTheDocument();
    expect(screen.queryByText("You marked this gluten-friendly.")).not.toBeInTheDocument();
  });

  it("names the safety STATE in the caption for the HEADLINE claim (not confirm/dispute)", () => {
    // "You confirmed this." reads awkwardly next to the Celiac-safe / Gluten-
    // friendly badges, so the headline caption names the state the vote records.
    renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="celiac_safe_vs_gluten_friendly"
        viewerVote="confirm"
        isSignedIn={true}
      />
    );
    expect(screen.getByText("You marked this celiac-safe.")).toBeInTheDocument();
    expect(screen.queryByText("You confirmed this.")).not.toBeInTheDocument();
    cleanup();

    renderWithQuery(
      <ClaimVoteControls
        listingId="listing-1"
        attribute="celiac_safe_vs_gluten_friendly"
        viewerVote="dispute"
        isSignedIn={true}
      />
    );
    expect(screen.getByText("You marked this gluten-friendly.")).toBeInTheDocument();
    expect(screen.queryByText("You disputed this.")).not.toBeInTheDocument();
  });

  it("keeps both buttons disabled until the roll-up invalidation settles", async () => {
    // The toggle branches on `viewerVote`, which the roll-up query provides —
    // so `busy` must hold through the refetch, not just the write. Simulate a
    // slow refetch with a never-resolving invalidateQueries.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(new Promise<void>(() => {}));
    render(
      <QueryClientProvider client={queryClient}>
        <ClaimVoteControls
          listingId="listing-1"
          attribute="dedicated_fryer"
          viewerVote={null}
          isSignedIn={true}
        />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Dedicated fryer" }));

    await waitFor(() => {
      expect(submitVoteMock).toHaveBeenCalledTimes(1);
    });
    // The write resolved, but the invalidation hasn't — the controls stay
    // disabled so a second click cannot act on a stale viewerVote.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dedicated fryer" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Dispute" })).toBeDisabled();
  });
});
