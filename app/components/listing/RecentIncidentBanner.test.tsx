import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { findRecentIncident } from "~/trust/incident-recency";
import { RecentIncidentBanner } from "./RecentIncidentBanner";

describe("RecentIncidentBanner", () => {
  it("renders a labelled region carrying the incident text label (not colour alone)", () => {
    render(<RecentIncidentBanner occurredOn="2026-06-01" />);
    expect(screen.getByRole("region", { name: "Recent incident warning" })).toBeInTheDocument();
    // Meaning is in text + icon, never colour alone.
    expect(screen.getByText(/Recent incident/)).toBeInTheDocument();
  });

  it("shows the absolute date of the incident", () => {
    render(<RecentIncidentBanner occurredOn="2026-06-01" />);
    expect(screen.getByText(/Jun 1, 2026/)).toBeInTheDocument();
  });
});

// Mirrors the listing-detail route's banner-visibility decision:
//   const recent = findRecentIncident(incidents, now);
//   {recent ? <RecentIncidentBanner occurredOn={recent.occurredOn} .../> : null}
describe("recent-incident banner visibility (route composition)", () => {
  const now = new Date("2026-06-28T12:00:00Z");

  function BannerForIncidents({ incidents }: { incidents: Array<{ occurredOn: string }> }) {
    const recent = findRecentIncident(incidents, now);
    return recent ? (
      <RecentIncidentBanner occurredOn={recent.occurredOn} nowMs={now.getTime()} />
    ) : null;
  }

  it("renders the banner when a recent incident exists", () => {
    render(<BannerForIncidents incidents={[{ occurredOn: "2026-06-20" }]} />);
    expect(screen.getByRole("region", { name: "Recent incident warning" })).toBeInTheDocument();
  });

  it("does NOT render the banner when only old incidents exist", () => {
    render(<BannerForIncidents incidents={[{ occurredOn: "2025-01-01" }]} />);
    expect(
      screen.queryByRole("region", { name: "Recent incident warning" })
    ).not.toBeInTheDocument();
  });
});
