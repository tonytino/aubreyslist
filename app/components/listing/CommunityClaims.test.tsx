import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ListingClaimAggregate } from "~/server/attestations/listing-summary";

/**
 * `ClaimVoteControls` (rendered per claim) calls attestation server functions
 * via TanStack Query mutations, so we mock the server-only `*.fn` module and
 * wrap renders in a QueryClientProvider. The roll-up display itself is pure.
 */
const submitVoteMock = vi.fn((_args: unknown) => Promise.resolve());
const removeVoteMock = vi.fn((_args: unknown) => Promise.resolve());
vi.mock("~/server/attestations/attestations.fn", () => ({
  submitVote: (args: unknown) => submitVoteMock(args),
  removeVote: (args: unknown) => removeVoteMock(args),
}));

import { CommunityClaims } from "./CommunityClaims";

const NOW = new Date("2026-06-28T12:00:00Z");
const WEEK = 7 * 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const claim = (overrides: Partial<ListingClaimAggregate>): ListingClaimAggregate => ({
  claimId: "claim-1",
  attribute: "dedicated_fryer",
  confirmCount: 0,
  disputeCount: 0,
  lastConfirmedAt: null,
  viewerVote: null,
  ...overrides,
});

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("CommunityClaims", () => {
  it("renders one roll-up per claim", () => {
    renderWithQuery(
      <CommunityClaims
        listingId="listing-1"
        viewerId={null}
        now={NOW}
        claims={[
          claim({
            claimId: "c1",
            attribute: "dedicated_fryer",
            confirmCount: 8,
            disputeCount: 1,
            lastConfirmedAt: ago(3 * WEEK),
          }),
          claim({
            claimId: "c2",
            attribute: "dedicated_gf_menu",
            confirmCount: 2,
            disputeCount: 0,
            lastConfirmedAt: ago(1 * WEEK),
          }),
        ]}
      />
    );
    expect(screen.getByText("Dedicated fryer")).toBeInTheDocument();
    expect(screen.getByText("8 confirm / 1 dispute")).toBeInTheDocument();
    expect(screen.getByText("Dedicated GF menu")).toBeInTheDocument();
    expect(screen.getByText("2 confirm / 0 dispute")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders nothing when there are no claims (caller keeps its placeholder)", () => {
    const { container } = renderWithQuery(
      <CommunityClaims listingId="listing-1" viewerId={null} now={NOW} claims={[]} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("hides the vote controls and shows a sign-in prompt for anonymous viewers", () => {
    renderWithQuery(
      <CommunityClaims
        listingId="listing-1"
        viewerId={null}
        now={NOW}
        claims={[claim({ claimId: "c1" })]}
      />
    );
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows confirm/dispute controls for a signed-in viewer", () => {
    renderWithQuery(
      <CommunityClaims
        listingId="listing-1"
        viewerId="user-1"
        now={NOW}
        claims={[claim({ claimId: "c1" })]}
      />
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dispute" })).toBeInTheDocument();
    // No vote yet → no retract affordance.
    expect(screen.queryByRole("button", { name: "Retract" })).not.toBeInTheDocument();
  });

  it("marks the viewer's own vote and offers a retract control", () => {
    renderWithQuery(
      <CommunityClaims
        listingId="listing-1"
        viewerId="user-1"
        now={NOW}
        claims={[claim({ claimId: "c1", confirmCount: 1, viewerVote: "confirm" })]}
      />
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Retract" })).toBeInTheDocument();
  });

  it("derives each row's recency + staleness from the injected `now`, not a live clock (#115)", () => {
    // Pin the real system clock FAR in the future. If a row read a fresh
    // `new Date()` instead of the passed-in instant, this confirmation would
    // age out and read "stale" / "years ago" — proving the regression.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    try {
      renderWithQuery(
        <CommunityClaims
          listingId="listing-1"
          viewerId={null}
          now={NOW}
          claims={[
            claim({
              claimId: "c1",
              attribute: "dedicated_fryer",
              confirmCount: 8,
              disputeCount: 1,
              lastConfirmedAt: ago(3 * WEEK),
            }),
          ]}
        />
      );
      // Recency phrasing is relative to the injected `now`, not the live clock.
      expect(screen.getByText("last confirmed 3 weeks ago")).toBeInTheDocument();
      // 3 weeks < 6-month window relative to `now`, so it is NOT flagged stale.
      expect(screen.queryByText("May be stale")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
