import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SAFETY_STATES, SAFETY_TOOLTIP, SafetySignal, type SafetyState } from "./SafetySignal";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const EXPECTED_LABELS: Record<SafetyState, string> = {
  "celiac-safe": "Celiac-safe",
  stale: "Needs update",
  incident: "Recent incident",
};

describe("SafetySignal", () => {
  it.each(SAFETY_STATES)("renders the text label for the %s state", (state) => {
    render(<SafetySignal state={state} />);
    expect(screen.getByText(EXPECTED_LABELS[state])).toBeInTheDocument();
  });

  const VARIANTS = ["solid", "soft"] as const;

  it.each(SAFETY_STATES.flatMap((state) => VARIANTS.map((variant) => [state, variant] as const)))(
    "pairs a colour + icon + label for the %s state (%s variant, never colour alone)",
    (state, variant) => {
      const { container } = render(<SafetySignal state={state} variant={variant} />);
      // Icon present, decorative (aria-hidden) so meaning lives in the label...
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("aria-hidden", "true");
      // ...and the text label present alongside it.
      const root = container.firstChild as HTMLElement;
      expect(within(root).getByText(EXPECTED_LABELS[state])).toBeInTheDocument();
      expect(root).toHaveAttribute("data-safety-state", state);
    }
  );

  it.each(SAFETY_STATES)("keeps the %s chip a one-line pill that never squeezes", (state) => {
    // Same box contract as `ClaimChip`: in a flex row that runs out of room the
    // chip holds its width and lets the row overflow, instead of wrapping its
    // label onto a second line and growing the row's height. A scrolling badge
    // row (browse card, detail hero) depends on this.
    const { container } = render(<SafetySignal state={state} />);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveClass("shrink-0", "whitespace-nowrap");
  });

  it("supports a custom label override", () => {
    render(<SafetySignal state="incident" label="Recent incident · 3 days ago" />);
    expect(screen.getByText("Recent incident · 3 days ago")).toBeInTheDocument();
  });

  it("exposes all three taxonomy states", () => {
    expect(SAFETY_STATES).toHaveLength(3);
  });

  it("keeps a DISTINCT icon per state (no shared glyph across the three states)", () => {
    const seen = new Set<string>();
    for (const state of SAFETY_STATES) {
      const { container } = render(<SafetySignal state={state} />);
      const svg = container.querySelector("svg");
      const shape = svg?.innerHTML ?? "";
      expect(seen.has(shape)).toBe(false);
      seen.add(shape);
    }
  });
});

describe("SAFETY_TOOLTIP (centralized explainer copy)", () => {
  it("has one non-empty, distinct entry per state", () => {
    const entries = SAFETY_STATES.map((state) => SAFETY_TOOLTIP[state]);
    for (const copy of entries) {
      expect(copy.length).toBeGreaterThan(0);
    }
    // Every state gets its own wording — no accidental duplication.
    expect(new Set(entries).size).toBe(SAFETY_STATES.length);
  });

  it("keeps the celiac-safe copy specific about cross-contamination", () => {
    expect(SAFETY_TOOLTIP["celiac-safe"]).toMatch(/celiac/i);
  });

  it("wraps a SafetySignal as a Tooltip trigger with the content associated", () => {
    // The chip is the trigger (asChild), the centralized copy is the content.
    // Force it open so the portaled content is asserted as reachable and
    // associated with the trigger via aria-describedby.
    render(
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <SafetySignal state="incident" tabIndex={0} />
        </TooltipTrigger>
        <TooltipContent>{SAFETY_TOOLTIP.incident}</TooltipContent>
      </Tooltip>
    );

    // The visible chip label is still present (meaning never rests on the tooltip).
    const chip = screen.getByText("Recent incident").closest("[data-safety-state]");
    expect(chip).not.toBeNull();
    // The supplementary copy is reachable...
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent(SAFETY_TOOLTIP.incident);
    // ...and associated with the trigger for assistive tech.
    expect(chip?.getAttribute("aria-describedby")).toContain(tip.id);
  });
});
