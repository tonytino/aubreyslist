import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { findRecentIncident } from "~/trust/incident-recency";
import { RecentIncidentBanner } from "./RecentIncidentBanner";

describe("RecentIncidentBanner", () => {
  it("announces via a polite live region carrying the incident text label (not colour alone)", () => {
    render(<RecentIncidentBanner occurredOn="2026-06-01" />);
    // A SAFETY-CRITICAL "recent harm" warning is an ARIA live region (role=status,
    // aria-live=polite) so assistive tech announces it when it appears — not a
    // passive landmark region.
    const banner = screen.getByRole("status", { name: "Recent incident warning" });
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("aria-live", "polite");
    // Meaning is in text + icon, never colour alone.
    expect(screen.getByText(/Recent incident/)).toBeInTheDocument();
  });

  it("keeps the pill to the plain, non-wrapping 'Recent incident' label", () => {
    // Regression for the mobile 3-line wrap bug: the pill used to interpolate
    // the relative recency into its own label ("Recent incident · 2 days ago"),
    // which wrapped on narrow screens. It must now render the exact default
    // label with a nowrap guard, and never the interpolated form.
    const { container } = render(
      <RecentIncidentBanner
        occurredOn="2026-06-01"
        nowMs={new Date("2026-06-03T00:00:00Z").getTime()}
      />
    );
    expect(screen.getByText("Recent incident")).toBeInTheDocument();
    expect(screen.queryByText(/Recent incident ·/)).not.toBeInTheDocument();
    const pill = container.querySelector('[data-safety-state="incident"]');
    expect(pill).toHaveClass("whitespace-nowrap");
  });

  it("shows the absolute date AND the relative recency in the body copy (not duplicated)", () => {
    render(
      <RecentIncidentBanner
        occurredOn="2026-06-01"
        nowMs={new Date("2026-06-03T00:00:00Z").getTime()}
      />
    );
    expect(screen.getByText(/Jun 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/2 days ago/)).toBeInTheDocument();
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
    expect(screen.getByRole("status", { name: "Recent incident warning" })).toBeInTheDocument();
  });

  it("does NOT render the banner when only old incidents exist", () => {
    render(<BannerForIncidents incidents={[{ occurredOn: "2025-01-01" }]} />);
    expect(
      screen.queryByRole("status", { name: "Recent incident warning" })
    ).not.toBeInTheDocument();
  });
});
