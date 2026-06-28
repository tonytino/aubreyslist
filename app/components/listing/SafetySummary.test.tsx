import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SafetySummary } from "./SafetySummary";

describe("SafetySummary", () => {
  it("renders an honest empty state when no trust data exists (no fabricated rating)", () => {
    render(<SafetySummary state={null} />);
    expect(screen.getByText("Not yet attested")).toBeInTheDocument();
    // The empty state must not claim a celiac-safe / gluten-friendly verdict.
    expect(screen.queryByText("Celiac-safe")).not.toBeInTheDocument();
    expect(screen.queryByText("Gluten-friendly")).not.toBeInTheDocument();
  });

  it("treats undefined state the same as null (empty state)", () => {
    render(<SafetySummary />);
    expect(screen.getByText("Not yet attested")).toBeInTheDocument();
  });

  it("renders the accessible SafetySignal (colour + icon + label) when a state is provided", () => {
    const { container } = render(<SafetySummary state="celiac-safe" />);
    expect(screen.getByText("Celiac-safe")).toBeInTheDocument();
    // Icon present and decorative — meaning lives in the visible label.
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // The "Not yet attested" empty state is gone once we have a verdict.
    expect(screen.queryByText("Not yet attested")).not.toBeInTheDocument();
  });

  it("renders distinct verdicts for celiac-safe vs gluten-friendly", () => {
    const { rerender } = render(<SafetySummary state="celiac-safe" />);
    expect(screen.getByText("Celiac-safe")).toBeInTheDocument();
    rerender(<SafetySummary state="gluten-friendly" />);
    expect(screen.getByText("Gluten-friendly")).toBeInTheDocument();
  });

  it("exposes an accessible heading for the section", () => {
    render(<SafetySummary state={null} />);
    expect(screen.getByRole("heading", { name: /gluten-free safety/i })).toBeInTheDocument();
  });
});
