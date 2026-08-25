import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  suggested: false,
  viewerVote: null,
  ...overrides,
});

// The full fixed taxonomy as the loader returns it: one entry per attribute,
// all empty (claimId null, zero votes) unless overridden.
const TAXONOMY = [
  "celiac_safe_vs_gluten_friendly",
  "dedicated_fryer",
  "dedicated_gf_menu",
  "off_menu_gf_on_request",
  "gf_substitutes",
] as const;

// Each attribute's confirm affordance is its own badge (icon + taxonomy label).
const CONFIRM_BADGE_NAMES = [
  "Celiac-safe",
  "Dedicated fryer",
  "Dedicated GF menu",
  "Off-menu GF on request",
  "GF substitutes",
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
    // A zero-vote attribute shows its honest empty state ("Not yet attested — no
    // confirmations or disputes yet"), never a fabricated rating.
    expect(screen.getAllByText(/no confirmations or disputes yet/).length).toBe(TAXONOMY.length);
    expect(screen.getAllByText("Not yet attested").length).toBe(TAXONOMY.length);
    // Every attribute is attestable via its own confirm badge...
    for (const name of CONFIRM_BADGE_NAMES) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    // ...and disputes: every attribute, headline included, shares the consistent
    // X + "Dispute" badge — a dispute records "not this", never a lesser state.
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
        claims={[claim({ claimId: null, attribute: "gf_substitutes" })]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "GF substitutes" }));

    await waitFor(() => {
      expect(submitVoteMock).toHaveBeenCalledTimes(1);
    });
    expect(submitVoteMock).toHaveBeenCalledWith({
      data: {
        listingId: "listing-1",
        attribute: "gf_substitutes",
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
    // No vote badges and no flag control — FlagControl login-gates itself too.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows the badge toggle controls for a signed-in viewer, with no Retract link", () => {
    renderWithQuery(
      <CommunityClaims
        listingId="listing-1"
        viewerId="user-1"
        now={NOW}
        claims={[claim({ claimId: "c1" })]}
      />
    );
    expect(screen.getByRole("button", { name: "Dedicated fryer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dispute" })).toBeInTheDocument();
    // Votes are toggles now — there is never a separate retract affordance.
    expect(screen.queryByRole("button", { name: "Retract" })).not.toBeInTheDocument();
  });

  it("marks the viewer's own vote as pressed and retracts it on a second press", async () => {
    renderWithQuery(
      <CommunityClaims
        listingId="listing-1"
        viewerId="user-1"
        now={NOW}
        claims={[claim({ claimId: "c1", confirmCount: 1, viewerVote: "confirm" })]}
      />
    );
    const confirm = screen.getByRole("button", { name: "Dedicated fryer" });
    expect(confirm).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Retract" })).not.toBeInTheDocument();

    fireEvent.click(confirm);

    await waitFor(() => {
      expect(removeVoteMock).toHaveBeenCalledTimes(1);
    });
    expect(removeVoteMock).toHaveBeenCalledWith({
      data: { listingId: "listing-1", attribute: "dedicated_fryer" },
    });
    expect(submitVoteMock).not.toHaveBeenCalled();
  });

  it("puts the flag icon-button on the claim's title row when a claim row exists (#39)", () => {
    renderWithQuery(
      <CommunityClaims
        listingId="listing-1"
        viewerId="user-1"
        now={NOW}
        claims={[claim({ claimId: "c1", attribute: "dedicated_fryer" })]}
      />
    );
    const flagButton = screen.getByRole("button", { name: "Flag claim" });
    // Right-aligned on the same header row as the claim's title: the flag
    // control and the title share the header container, and the vote badges
    // live outside it.
    const headerRow = flagButton.parentElement;
    expect(headerRow).not.toBeNull();
    if (headerRow === null) throw new Error("unreachable");
    expect(within(headerRow).getByText("Dedicated fryer")).toBeInTheDocument();
    expect(within(headerRow).queryByRole("button", { name: "Dispute" })).not.toBeInTheDocument();
  });

  it("derives each row's recency + staleness from the injected `now`, not a live clock (#115)", () => {
    // Pin the real system clock far in the future. If a row read a fresh
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
      // 3 weeks < 6-month window relative to `now`, so it is not flagged stale.
      expect(screen.queryByText("Needs update")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
