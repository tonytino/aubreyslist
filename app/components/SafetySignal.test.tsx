import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  SAFETY_STATES,
  SAFETY_TOOLTIP,
  SafetySignal,
  type SafetyState,
  safetyLabel,
} from "./SafetySignal";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const EXPECTED_LABELS: Record<SafetyState, string> = {
  "celiac-safe": "Celiac-safe",
  "gluten-friendly": "Gluten-friendly",
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

  it("renders the brand wheat-strike glyph (masked cutout) for gluten-friendly", () => {
    const { container } = render(<SafetySignal state="gluten-friendly" />);
    // The gluten-friendly icon is now the brand ear-of-wheat with a diagonal
    // strike CUTOUT — a <mask> holding a strike <line>, with the wheat grouped
    // under it — not the old plain lucide Leaf. The icon stays decorative.
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("mask line")).not.toBeNull();
    expect(container.querySelector("g[mask]")).not.toBeNull();
    // ...and the meaning still lives in the visible label.
    expect(screen.getByText("Gluten-friendly")).toBeInTheDocument();
  });

  it("keeps a DISTINCT icon per state (no shared glyph across the four states)", () => {
    // Only gluten-friendly uses the masked wheat cutout; the other three are
    // plain lucide glyphs with no mask — so the four icons stay distinguishable
    // (which also holds up in greyscale, where colour drops out).
    for (const state of SAFETY_STATES) {
      const { container } = render(<SafetySignal state={state} />);
      const hasMask = container.querySelector("g[mask]") !== null;
      expect(hasMask).toBe(state === "gluten-friendly");
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

  it("keeps the celiac-safe vs gluten-friendly distinction in the copy", () => {
    expect(SAFETY_TOOLTIP["celiac-safe"]).toMatch(/celiac/i);
    expect(SAFETY_TOOLTIP["gluten-friendly"]).toMatch(/not a celiac-safe promise/i);
  });

  it("wraps a SafetySignal as a Tooltip trigger with the content associated", () => {
    // The exact wiring used at the About / style-guide / admin call sites: the
    // chip is the trigger (asChild), the centralized copy is the content. Force
    // it open so the portaled content is asserted as reachable AND associated
    // with the trigger via aria-describedby.
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
