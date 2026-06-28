import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ListingClaimAggregate } from "~/server/attestations/listing-summary";
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
  ...overrides,
});

describe("CommunityClaims", () => {
  it("renders one roll-up per claim", () => {
    render(
      <CommunityClaims
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
    const { container } = render(<CommunityClaims now={NOW} claims={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
