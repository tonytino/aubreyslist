import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrustPlaceholder } from "./TrustPlaceholder";

describe("TrustPlaceholder", () => {
  it("renders the title as an accessible heading wired to its section", () => {
    render(<TrustPlaceholder title="Community claims" description="Claims will appear here." />);
    expect(screen.getByRole("heading", { name: "Community claims" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Community claims" })).toBeInTheDocument();
  });

  it("marks the slot as a coming-soon placeholder in text (not colour alone)", () => {
    render(<TrustPlaceholder title="Incident reports" description="None reported yet." />);
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(screen.getByText("None reported yet.")).toBeInTheDocument();
  });

  it("renders real evidence children when EPIC 4 feeds the slot", () => {
    render(
      <TrustPlaceholder title="Community claims" description="…">
        <p>Dedicated fryer — 8 confirm / 1 dispute</p>
      </TrustPlaceholder>
    );
    expect(screen.getByText("Dedicated fryer — 8 confirm / 1 dispute")).toBeInTheDocument();
  });

  it("drops the coming-soon badge once real evidence fills the slot", () => {
    render(
      <TrustPlaceholder title="Incident reports" description="…">
        <p>A real incident</p>
      </TrustPlaceholder>
    );
    expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
  });
});
