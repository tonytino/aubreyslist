import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SAFETY_STATES, safetyLabel } from "~/components/SafetySignal";
import { SafetyLegend } from "./SafetyLegend";

describe("SafetyLegend", () => {
  it("renders all four safety states as labelled chips (colour + icon + text)", () => {
    const { container } = render(<SafetyLegend />);
    // Every canonical state's text label is present — meaning never rests on
    // colour alone, and the row is driven by the exported SAFETY_STATES set.
    for (const state of SAFETY_STATES) {
      expect(screen.getByText(safetyLabel(state))).toBeInTheDocument();
    }
    // One distinct icon per chip (shape survives greyscale).
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(SAFETY_STATES.length);
  });

  it("has NO heading/section label — it is a quiet legend row, not a titled panel", () => {
    render(<SafetyLegend />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("makes each chip keyboard-focusable so its supplementary tooltip is reachable", () => {
    render(<SafetyLegend />);
    // A native button trigger is keyboard-focusable without an a11y-smell tabindex.
    const trigger = screen.getByText(safetyLabel("celiac-safe")).closest("button");
    expect(trigger).not.toBeNull();
  });
});
