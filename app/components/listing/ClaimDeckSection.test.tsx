import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ListingClaimAggregate } from "~/server/attestations/listing-summary";

/**
 * ClaimDeckSection tests (AUB-231, listing-detail host): CTA auth gating, the
 * sheet-hosted deck pre-seeded from the viewer's votes, IMMEDIATE writes with
 * claims roll-up invalidation, skip-leaves-vote-untouched, and the mis-swipe
 * Undo (restore the previous vote, or retract when there was none).
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

/** The Undo action captured from the last "Vote recorded" success toast. */
function lastUndoAction(): { label: string; onClick: () => void } {
  const successMock = vi.mocked(toast.success);
  const lastCall = successMock.mock.calls.at(-1);
  const options = lastCall?.[1] as { action?: { label: string; onClick: () => void } } | undefined;
  if (!options?.action) {
    throw new Error("expected the last success toast to carry an Undo action");
  }
  return options.action;
}

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
    // The mis-swipe escape hatch rides on the success toast.
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "Vote recorded",
        expect.objectContaining({
          action: expect.objectContaining({ label: "Undo" }),
        })
      );
    });
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

  it("Undo after a first-time vote retracts it (there was no previous vote)", async () => {
    renderWithQuery(<ClaimDeckSection listingId="listing-1" claims={fullTaxonomy()} isSignedIn />);

    fireEvent.click(screen.getByRole("button", { name: CTA }));
    await screen.findByRole("heading", { name: "Celiac-safe" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });

    act(() => {
      lastUndoAction().onClick();
    });

    await waitFor(() => {
      expect(removeVoteMock).toHaveBeenCalledTimes(1);
    });
    expect(removeVoteMock).toHaveBeenCalledWith({
      data: { listingId: "listing-1", attribute: "celiac_safe_vs_gluten_friendly" },
    });
  });

  it("Undo after changing a vote restores the PREVIOUS vote via submitVote", async () => {
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

    act(() => {
      lastUndoAction().onClick();
    });

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
});
