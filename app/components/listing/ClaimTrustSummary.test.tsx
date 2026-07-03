import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClaimTrustSummaryRow } from "./ClaimTrustSummary";

const NOW = new Date("2026-06-28T12:00:00Z");
const WEEK = 7 * 24 * 60 * 60 * 1000;
const MONTH = 30 * 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("ClaimTrustSummaryRow", () => {
  it("renders the canonical 'N confirm / M dispute · last confirmed …' roll-up", () => {
    render(
      <ClaimTrustSummaryRow
        attribute="dedicated_fryer"
        aggregate={{ confirmCount: 8, disputeCount: 1, lastConfirmedAt: ago(3 * WEEK) }}
        now={NOW}
      />
    );
    expect(screen.getByText("Dedicated fryer")).toBeInTheDocument();
    expect(screen.getByText("8 confirm / 1 dispute")).toBeInTheDocument();
    expect(screen.getByText("last confirmed 3 weeks ago")).toBeInTheDocument();
  });

  it("shows an honest empty state when the claim has no attestations yet", () => {
    render(
      <ClaimTrustSummaryRow
        attribute="dedicated_fryer"
        aggregate={{ confirmCount: 0, disputeCount: 0, lastConfirmedAt: null }}
        now={NOW}
      />
    );
    // Honest empty state (AUB-131): an explicit "Not yet attested" lead + the
    // "no confirmations or disputes yet" gloss — never a fabricated verdict.
    expect(screen.getByText("Not yet attested")).toBeInTheDocument();
    expect(screen.getByText(/no confirmations or disputes yet/)).toBeInTheDocument();
    // Never fabricates a count or a recency.
    expect(screen.queryByText(/confirm \//)).not.toBeInTheDocument();
  });

  it("shows the 'Suggested by Aubrey's Bot' badge for a bot-suggested claim (AUB-31)", () => {
    render(
      <ClaimTrustSummaryRow
        attribute="dedicated_fryer"
        aggregate={{ confirmCount: 0, disputeCount: 0, lastConfirmedAt: null, suggested: true }}
        now={NOW}
      />
    );
    // Meaning is in text (never icon/colour alone), and it replaces — not
    // supplements — the bare empty state.
    expect(screen.getByText("Suggested by Aubrey's Bot")).toBeInTheDocument();
    expect(screen.queryByText("No confirmations or disputes yet")).not.toBeInTheDocument();
    // A suggestion is not evidence: no fabricated count.
    expect(screen.queryByText(/confirm \//)).not.toBeInTheDocument();
  });

  it("suppresses the suggestion badge once the claim has real evidence", () => {
    render(
      <ClaimTrustSummaryRow
        attribute="dedicated_fryer"
        aggregate={{
          confirmCount: 2,
          disputeCount: 0,
          lastConfirmedAt: ago(1 * WEEK),
          suggested: true,
        }}
        now={NOW}
      />
    );
    // Real votes win — the badge never sits beside a real count.
    expect(screen.queryByText("Suggested by Aubrey's Bot")).not.toBeInTheDocument();
    expect(screen.getByText("2 confirm / 0 dispute")).toBeInTheDocument();
  });

  it("surfaces a text 'Needs update' cue for an aged confirmation (not colour alone)", () => {
    render(
      <ClaimTrustSummaryRow
        attribute="dedicated_fryer"
        aggregate={{ confirmCount: 5, disputeCount: 0, lastConfirmedAt: ago(8 * MONTH) }}
        now={NOW}
      />
    );
    // Meaning carried in the visible word, not just the colour token.
    expect(screen.getByText("Needs update")).toBeInTheDocument();
  });

  it("omits the stale cue for a fresh claim", () => {
    render(
      <ClaimTrustSummaryRow
        attribute="dedicated_fryer"
        aggregate={{ confirmCount: 5, disputeCount: 0, lastConfirmedAt: ago(1 * WEEK) }}
        now={NOW}
      />
    );
    expect(screen.queryByText("Needs update")).not.toBeInTheDocument();
  });

  it("renders the confirm/dispute clarifier for an attribute that has one (Celiac-safe, #175)", () => {
    render(
      <ClaimTrustSummaryRow
        attribute="celiac_safe_vs_gluten_friendly"
        aggregate={{ confirmCount: 0, disputeCount: 0, lastConfirmedAt: null }}
        now={NOW}
      />
    );
    // The row label is the reframed "Celiac-safe" (exact — the clarifier below
    // also contains "celiac-safe" lower-cased).
    expect(screen.getByText("Celiac-safe", { exact: true })).toBeInTheDocument();
    // The clarifier disambiguates what a vote means, so "confirm" is never vague.
    expect(screen.getByText(/Confirm if the community vouches/)).toBeInTheDocument();
  });

  it("renders the honest one-line fact for a non-headline attribute", () => {
    render(
      <ClaimTrustSummaryRow
        attribute="dedicated_fryer"
        aggregate={{ confirmCount: 0, disputeCount: 0, lastConfirmedAt: null }}
        now={NOW}
      />
    );
    expect(screen.queryByText(/Confirm if the community vouches/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/shared fryer oil is a major cross-contamination risk/)
    ).toBeInTheDocument();
  });
});
