import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminPanel } from "./AdminPanel";

describe("AdminPanel", () => {
  it("shows all three sections to an admin", () => {
    render(
      <AdminPanel viewerRole="admin" settings={{ intakeMode: "places", stalenessMonths: 6 }} />
    );
    expect(screen.getByRole("heading", { name: "App settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Role management" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Moderation queue" })).toBeInTheDocument();
  });

  it("renders the current settings read-only (no fabricated data)", () => {
    render(
      <AdminPanel viewerRole="admin" settings={{ intakeMode: "manual", stalenessMonths: 9 }} />
    );
    expect(screen.getByText("manual")).toBeInTheDocument();
    expect(screen.getByText("9 months")).toBeInTheDocument();
    // The settings section is explicitly read-only until #24.
    expect(screen.getByText("Read-only")).toBeInTheDocument();
  });

  it("shows only the moderation queue to a moderator", () => {
    render(<AdminPanel viewerRole="moderator" settings={null} />);
    expect(screen.getByRole("heading", { name: "Moderation queue" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "App settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Role management" })).not.toBeInTheDocument();
  });
});
