import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnswerMap } from "./AddListingWizard";
import { deriveStepperNodes, ProgressStepper } from "./ProgressStepper";

/**
 * ProgressStepper tests (collapsed 3-node rail): the pure status
 * derivation (current / done / skipped / todo — the single attest node rolls
 * the whole deck up) and the `Step N of 3 · name` aria-live line, plus that
 * back-nav is a button and forward is gated until a place is chosen.
 */

const NO_ANSWERS: AnswerMap = {
  celiac_safe: undefined,
  dedicated_fryer: undefined,
  dedicated_gf_menu: undefined,
  off_menu_gf_on_request: undefined,
  gf_substitutes: undefined,
};

const ALL_ATTESTED: AnswerMap = {
  celiac_safe: "confirm",
  dedicated_fryer: "dispute",
  dedicated_gf_menu: "confirm",
  off_menu_gf_on_request: "confirm",
  gf_substitutes: "dispute",
};

describe("deriveStepperNodes", () => {
  it("marks the current step and leaves the rest todo at the start", () => {
    const nodes = deriveStepperNodes(0, false, NO_ANSWERS);
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toMatchObject({ label: "Find the place", status: "current" });
    expect(nodes[1]).toMatchObject({ label: "Attest what you know", status: "todo" });
    expect(nodes[2]).toMatchObject({ label: "Review", status: "todo" });
  });

  it("keeps the attest node todo while ANY attribute is still unanswered", () => {
    const partial: AnswerMap = { ...NO_ANSWERS, celiac_safe: "confirm" };
    const nodes = deriveStepperNodes(2, true, partial);
    expect(nodes[0]?.status).toBe("done"); // place chosen
    expect(nodes[1]?.status).toBe("todo"); // deck not finished
    expect(nodes[2]?.status).toBe("current");
  });

  it("marks the attest node done when every attribute is confirm/dispute", () => {
    const nodes = deriveStepperNodes(2, true, ALL_ATTESTED);
    expect(nodes[1]?.status).toBe("done");
  });

  it("marks the attest node skipped (dashed, non-alarming) when answered with a skip", () => {
    const withSkip: AnswerMap = { ...ALL_ATTESTED, dedicated_fryer: "skip" };
    const nodes = deriveStepperNodes(2, true, withSkip);
    expect(nodes[1]?.status).toBe("skipped");
  });

  it("marks the attest node current while on the deck stage", () => {
    const nodes = deriveStepperNodes(1, true, NO_ANSWERS);
    expect(nodes[1]?.status).toBe("current");
  });
});

describe("ProgressStepper", () => {
  it("announces the current step in a polite live region", () => {
    render(<ProgressStepper step={1} hasPlace answers={NO_ANSWERS} onNavigate={vi.fn()} />);
    const status = screen.getByText(/Step 2 of 3 · Attest what you know/);
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("gates forward navigation until a place is chosen", () => {
    const onNavigate = vi.fn();
    render(
      <ProgressStepper step={0} hasPlace={false} answers={NO_ANSWERS} onNavigate={onNavigate} />
    );
    // The review node (forward) is disabled with no place.
    const reviewNode = screen.getByRole("button", { name: /Step 3: Review/ });
    expect(reviewNode).toBeDisabled();
  });

  it("lets a chosen place unlock forward jumps", () => {
    const onNavigate = vi.fn();
    render(<ProgressStepper step={0} hasPlace answers={NO_ANSWERS} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /Step 3: Review/ }));
    expect(onNavigate).toHaveBeenCalledWith(2);
  });
});
