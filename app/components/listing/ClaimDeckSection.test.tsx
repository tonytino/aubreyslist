import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ListingClaimAggregate } from "~/server/attestations/listing-summary";

/**
 * ClaimDeckSection tests: CTA auth gating, the sheet-hosted deck pre-seeded from
 * the viewer's votes, immediate writes with claims roll-up invalidation,
 * skip-leaves-vote-untouched, and the mis-swipe Undo (restore the previous vote,
 * or retract when there was none).
 */
const submitVoteMock = vi.fn((_args: unknown) => Promise.resolve());
const removeVoteMock = vi.fn((_args: unknown) => Promise.resolve());
vi.mock("~/server/attestations/attestations.fn", () => ({
  submitVote: (args: unknown) => submitVoteMock(args),
  removeVote: (args: unknown) => removeVoteMock(args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";

import { ClaimDeckSection } from "./ClaimDeckSection";
import { claimsQueryKey } from "./CommunityClaims";

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

const claim = (overrides: Partial<ListingClaimAggregate>): ListingClaimAggregate => ({
  claimId: "claim-1",
  attribute: "dedicated_fryer",
  confirmCount: 0,
  disputeCount: 0,
  lastConfirmedAt: null,
  suggested: false,
  viewerVote: null,
  ...overrides,
});

const TAXONOMY = [
  "celiac_safe_vs_gluten_friendly",
  "dedicated_fryer",
  "dedicated_gf_menu",
  "off_menu_gf_on_request",
  "gf_substitutes",
] as const;

const fullTaxonomy = (
  overrides: Partial<Record<(typeof TAXONOMY)[number], Partial<ListingClaimAggregate>>> = {}
): ListingClaimAggregate[] =>
  TAXONOMY.map((attribute) => claim({ claimId: null, attribute, ...(overrides[attribute] ?? {}) }));

function renderWithQuery(ui: ReactElement): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return queryClient;
}

const CTA = "Been here? Confirm what you know";

describe("ClaimDeckSection", () => {
  it("renders NOTHING for anonymous viewers (the existing sign-in prompts remain the path)", () => {
    renderWithQuery(
      <ClaimDeckSection listingId="listing-1" claims={fullTaxonomy()} isSignedIn={false} />
    );
    expect(screen.queryByRole("button", { name: CTA })).not.toBeInTheDocument();
  });

  it("shows the CTA for signed-in viewers and opens the deck pre-seeded from viewer votes", async () => {
    renderWithQuery(
      <ClaimDeckSection
        listingId="listing-1"
        claims={fullTaxonomy({
          celiac_safe_vs_gluten_friendly: { claimId: "c1", viewerVote: "confirm" },
        })}
        isSignedIn
      />
    );

    fireEvent.click(screen.getByRole("button", { name: CTA }));

    // The deck opens on card 1 with the pre-voted caption visible.
    await screen.findByRole("heading", { name: "Celiac-safe" });
    expect(screen.getByText("Card 1 of 5")).toBeInTheDocument();
    expect(screen.getByText("You marked this celiac-safe.")).toBeInTheDocument();
  });

  it("writes IMMEDIATELY on confirm — same submitVote semantics + roll-up invalidation", async () => {
    const queryClient = renderWithQuery(
      <ClaimDeckSection listingId="listing-1" claims={fullTaxonomy()} isSignedIn />
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByRole("button", { name: CTA }));
    await screen.findByRole("heading", { name: "Celiac-safe" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(submitVoteMock).toHaveBeenCalledTimes(1);
    });
    expect(submitVoteMock).toHaveBeenCalledWith({
      data: {
        listingId: "listing-1",
        attribute: "celiac_safe_vs_gluten_friendly",
        value: "confirm",
      },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: claimsQueryKey("listing-1") });
    // The mis-swipe escape hatch is an inline row inside the modal sheet —
    // a real, reachable control, not a toast action outside the focus trap.
    expect(await screen.findByText("Vote recorded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    // Single announcer (AUB-269): the deck's aria-live region carries the
    // "Recorded: …" announcement; the undo row is NOT a second status region.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("skip ('Not sure') leaves an existing vote untouched — no write, vote kept in the summary", async () => {
    renderWithQuery(
      <ClaimDeckSection
        listingId="listing-1"
        claims={fullTaxonomy({
          celiac_safe_vs_gluten_friendly: { claimId: "c1", viewerVote: "confirm" },
        })}
        isSignedIn
      />
    );

    fireEvent.click(screen.getByRole("button", { name: CTA }));
    await screen.findByRole("heading", { name: "Celiac-safe" });

    // Skip all five cards.
    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(await screen.findByRole("button", { name: "Not sure" }));
    }

    // No writes at all — skipping never touches the standing vote.
    const summary = await screen.findByRole("region", { name: "Your answers" });
    expect(submitVoteMock).not.toHaveBeenCalled();
    expect(removeVoteMock).not.toHaveBeenCalled();
    // The standing headline vote is still shown (celiac-safe chip), while the
    // four genuinely un-voted attributes stay honestly un-attested.
    expect(summary.querySelector('[data-safety-state="celiac-safe"]')).not.toBeNull();
    expect(screen.getAllByText("Not yet attested")).toHaveLength(4);
  });

  it("clicking the rendered Undo after a first-time vote retracts it (no previous vote)", async () => {
    renderWithQuery(<ClaimDeckSection listingId="listing-1" claims={fullTaxonomy()} isSignedIn />);

    fireEvent.click(screen.getByRole("button", { name: CTA }));
    await screen.findByRole("heading", { name: "Celiac-safe" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    // The real DOM path: click the inline Undo control rendered inside the
    // modal sheet (a toast action would sit outside its focus trap).
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => {
      expect(removeVoteMock).toHaveBeenCalledTimes(1);
    });
    expect(removeVoteMock).toHaveBeenCalledWith({
      data: { listingId: "listing-1", attribute: "celiac_safe_vs_gluten_friendly" },
    });
    // The affordance retires itself once used.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Vote removed");
    });
  });

  it("clicking the rendered Undo after changing a vote restores the PREVIOUS vote", async () => {
    renderWithQuery(
      <ClaimDeckSection
        listingId="listing-1"
        claims={fullTaxonomy({
          celiac_safe_vs_gluten_friendly: { claimId: "c1", viewerVote: "dispute" },
        })}
        isSignedIn
      />
    );

    fireEvent.click(screen.getByRole("button", { name: CTA }));
    await screen.findByRole("heading", { name: "Celiac-safe" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(submitVoteMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    // The undo re-submits the previous dispute — never a blind retract.
    await waitFor(() => {
      expect(submitVoteMock).toHaveBeenCalledTimes(2);
    });
    expect(submitVoteMock).toHaveBeenLastCalledWith({
      data: {
        listingId: "listing-1",
        attribute: "celiac_safe_vs_gluten_friendly",
        value: "dispute",
      },
    });
    expect(removeVoteMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Previous vote restored");
    });
  });

  it("a newer write replaces the undo target — Undo can never clobber the newer vote", async () => {
    renderWithQuery(<ClaimDeckSection listingId="listing-1" claims={fullTaxonomy()} isSignedIn />);

    fireEvent.click(screen.getByRole("button", { name: CTA }));
    await screen.findByRole("heading", { name: "Celiac-safe" });
    // Write #1 (headline), then advance and write #2 (dedicated fryer) while
    // the first undo affordance is still live.
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByRole("heading", { name: "Dedicated fryer" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    // Exactly one undo affordance exists, targeting only the latest write.
    const undoButtons = await screen.findAllByRole("button", { name: "Undo" });
    expect(undoButtons).toHaveLength(1);
    const undoButton = undoButtons[0];
    if (!undoButton) throw new Error("unreachable");
    fireEvent.click(undoButton);

    await waitFor(() => {
      expect(removeVoteMock).toHaveBeenCalledTimes(1);
    });
    // It retracts the fryer vote (write #2); the headline vote is untouched.
    expect(removeVoteMock).toHaveBeenCalledWith({
      data: { listingId: "listing-1", attribute: "dedicated_fryer" },
    });
  });

  it("completes to the deck-internal summary whose Done closes the sheet", async () => {
    renderWithQuery(<ClaimDeckSection listingId="listing-1" claims={fullTaxonomy()} isSignedIn />);

    fireEvent.click(screen.getByRole("button", { name: CTA }));
    await screen.findByRole("heading", { name: "Celiac-safe" });
    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(await screen.findByRole("button", { name: "Not sure" }));
    }

    await screen.findByRole("region", { name: "Your answers" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Your answers" })).not.toBeInTheDocument();
    });
    // Back on the tab with the CTA still available.
    expect(screen.getByRole("button", { name: CTA })).toBeInTheDocument();
  });

  it("reopening after a Done close starts with a CLEAN undo slot (AUB-269)", async () => {
    renderWithQuery(<ClaimDeckSection listingId="listing-1" claims={fullTaxonomy()} isSignedIn />);

    // Session 1: write once (the undo row appears), finish, close via Done —
    // which does NOT pass through Radix's onOpenChange.
    fireEvent.click(screen.getByRole("button", { name: CTA }));
    await screen.findByRole("heading", { name: "Celiac-safe" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Vote recorded")).toBeInTheDocument();
    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(await screen.findByRole("button", { name: "Not sure" }));
    }
    await screen.findByRole("region", { name: "Your answers" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Your answers" })).not.toBeInTheDocument();
    });

    // Session 2: the previous session's "Vote recorded · Undo" must NOT greet
    // the reopen — a stale Undo here would retract the earlier, settled vote.
    fireEvent.click(screen.getByRole("button", { name: CTA }));
    await screen.findByRole("heading", { name: "Celiac-safe" });
    expect(screen.queryByText("Vote recorded")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });
});
