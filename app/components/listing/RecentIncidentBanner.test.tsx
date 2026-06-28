import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecentIncidentBanner } from "./RecentIncidentBanner";

describe("RecentIncidentBanner", () => {
  it("renders an alert region carrying the incident text label (not colour alone)", () => {
    render(<RecentIncidentBanner occurredOn="2026-06-01" />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    // Meaning is in text + icon, never colour alone.
    expect(screen.getByText(/Recent incident/)).toBeInTheDocument();
  });

  it("shows the absolute date of the incident", () => {
    render(<RecentIncidentBanner occurredOn="2026-06-01" />);
    expect(screen.getByText(/Jun 1, 2026/)).toBeInTheDocument();
  });
});
