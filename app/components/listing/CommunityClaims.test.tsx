import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// The full fixed taxonomy as the loader returns it (#150): one entry per
// attribute, all empty (claimId null, zero votes) unless overridden.
const TAXONOMY = [
  "celiac_safe_vs_gluten_friendly",
  "dedicated_fryer",
  "cross_contamination_protocol",
  "dedicated_gf_menu",
  "off_menu_gf_on_request",
  "staff_knowledge",
  "gf_substitutes",
] as const;

const fullTaxonomy = (): ListingClaimAggregate[] =>
  TAXONOMY.map((attribute) => claim({ claimId: null, attribute }));

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

  it("ALWAYS renders the full taxonomy as attestable, incl. zero-vote attributes (#150)", () => {
    renderWithQuery(
      <CommunityClaims listingId="listing-1" viewerId="user-1" now={NOW} claims={fullTaxonomy()} />
    );

    // One row per taxonomy attribute — no "coming soon" dead-end.
    expect(screen.getAllByRole("listitem")).toHaveLength(TAXONOMY.length);
    // A zero-vote attribute shows its honest empty state, never a fabricated rating.
    expect(screen.getAllByText("No confirmations or disputes yet").length).toBe(TAXONOMY.length);
    // Every attribute is attestable: confirm/dispute controls on each row.
    expect(screen.getAllByRole("button", { name: "Confirm" })).toHaveLength(TAXONOMY.length);
    expect(screen.getAllByRole("button", { name: "Dispute" })).toHaveLength(TAXONOMY.length);
    // No claim row exists yet, so no "Flag claim" control is offered.
    expect(screen.queryByRole("button", { name: "Flag claim" })).not.toBeInTheDocument();
  });

  it("calls the vote mutation with {listingId, attribute, value} on a zero-vote attribute (#150)", async () => {
    renderWithQuery(
      <CommunityClaims
        listingId="listing-1"
        viewerId="user-1"
        now={NOW}
        claims={[claim({ claimId: null, attribute: "cross_contamination_protocol" })]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(submitVoteMock).toHaveBeenCalledTimes(1);
    });
    expect(submitVoteMock).toHaveBeenCalledWith({
      data: {
        listingId: "listing-1",
        attribute: "cross_contamination_protocol",
        value: "confirm",
      },
    });
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
