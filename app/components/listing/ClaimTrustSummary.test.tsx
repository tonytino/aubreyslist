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
    expect(screen.getByText("No confirmations or disputes yet")).toBeInTheDocument();
    // Never fabricates a count or a recency.
    expect(screen.queryByText(/confirm \//)).not.toBeInTheDocument();
  });

  it("surfaces a text 'May be stale' cue for an aged confirmation (not colour alone)", () => {
    render(
      <ClaimTrustSummaryRow
        attribute="dedicated_fryer"
        aggregate={{ confirmCount: 5, disputeCount: 0, lastConfirmedAt: ago(8 * MONTH) }}
        now={NOW}
      />
    );
    // Meaning carried in the visible word, not just the colour token.
    expect(screen.getByText("May be stale")).toBeInTheDocument();
  });

  it("omits the stale cue for a fresh claim", () => {
    render(
      <ClaimTrustSummaryRow
        attribute="dedicated_fryer"
        aggregate={{ confirmCount: 5, disputeCount: 0, lastConfirmedAt: ago(1 * WEEK) }}
        now={NOW}
      />
    );
    expect(screen.queryByText("May be stale")).not.toBeInTheDocument();
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

  it("omits the clarifier for a self-evident attribute", () => {
    render(
      <ClaimTrustSummaryRow
        attribute="dedicated_fryer"
        aggregate={{ confirmCount: 0, disputeCount: 0, lastConfirmedAt: null }}
        now={NOW}
      />
    );
    expect(screen.queryByText(/Confirm if the community vouches/)).not.toBeInTheDocument();
  });
});
