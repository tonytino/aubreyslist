import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecentIncidentBanner } from "./RecentIncidentBanner";

// `findRecentIncident` is a pure helper, but it lives in a module that also
// imports server-only deps (DB client, auth guards). Stub those so the helper
// can be exercised in jsdom — we want to assert the route's banner-visibility
// composition (helper output -> banner render), not the DB.
vi.mock("~/db/client", () => ({ getDb: () => ({}) }));
vi.mock("~/server/auth/guards", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("~/server/rate-limit", () => ({ enforceWriteLimit: vi.fn() }));

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

  function BannerForIncidents({
    incidents,
    findRecent,
  }: {
    incidents: Array<{ occurredOn: string }>;
    findRecent: (list: Array<{ occurredOn: string }>, now: Date) => { occurredOn: string } | null;
  }) {
    const recent = findRecent(incidents, now);
    return recent ? (
      <RecentIncidentBanner occurredOn={recent.occurredOn} nowMs={now.getTime()} />
    ) : null;
  }

  it("renders the banner when a recent incident exists", async () => {
    const { findRecentIncident } = await import("~/server/incidents");
    render(
      <BannerForIncidents
        incidents={[{ occurredOn: "2026-06-20" }]}
        findRecent={findRecentIncident}
      />
    );
    expect(screen.getByRole("region", { name: "Recent incident warning" })).toBeInTheDocument();
  });

  it("does NOT render the banner when only old incidents exist", async () => {
    const { findRecentIncident } = await import("~/server/incidents");
    render(
      <BannerForIncidents
        incidents={[{ occurredOn: "2025-01-01" }]}
        findRecent={findRecentIncident}
      />
    );
    expect(
      screen.queryByRole("region", { name: "Recent incident warning" })
    ).not.toBeInTheDocument();
  });
});
