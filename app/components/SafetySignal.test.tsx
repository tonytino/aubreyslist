import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SAFETY_STATES, SafetySignal, type SafetyState, safetyLabel } from "./SafetySignal";

const EXPECTED_LABELS: Record<SafetyState, string> = {
  "celiac-safe": "Celiac-safe",
  "gluten-friendly": "Gluten-friendly",
  stale: "May be stale",
  incident: "Recent incident",
};

describe("SafetySignal", () => {
  it.each(SAFETY_STATES)("renders the text label for the %s state", (state) => {
    render(<SafetySignal state={state} />);
    expect(screen.getByText(EXPECTED_LABELS[state])).toBeInTheDocument();
  });

  it.each(SAFETY_STATES)(
    "pairs an icon with the label for the %s state (never colour alone)",
    (state) => {
      const { container } = render(<SafetySignal state={state} />);
      // Icon present...
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("aria-hidden", "true");
      // ...AND the text label present alongside it.
      const root = container.firstChild as HTMLElement;
      expect(within(root).getByText(EXPECTED_LABELS[state])).toBeInTheDocument();
      expect(root).toHaveAttribute("data-safety-state", state);
    }
  );

  it("renders distinct labels for celiac-safe vs gluten-friendly", () => {
    expect(safetyLabel("celiac-safe")).not.toBe(safetyLabel("gluten-friendly"));
  });

  it("supports a custom label override", () => {
    render(<SafetySignal state="incident" label="Recent incident · 3 days ago" />);
    expect(screen.getByText("Recent incident · 3 days ago")).toBeInTheDocument();
  });

  it("exposes all four taxonomy states", () => {
    expect(SAFETY_STATES).toHaveLength(4);
  });
});
