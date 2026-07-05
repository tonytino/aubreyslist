import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnswerMap } from "./AddListingWizard";
import { deriveStepperNodes, ProgressStepper } from "./ProgressStepper";

/**
 * ProgressStepper tests: the pure status derivation (current / done / skipped /
 * todo) and the `Step N of 7 · name` aria-live line, plus that back-nav is a
 * button and forward is gated until a place is chosen.
 */

const NO_ANSWERS: AnswerMap = {
  celiac_safe_vs_gluten_friendly: undefined,
  dedicated_fryer: undefined,
  dedicated_gf_menu: undefined,
  off_menu_gf_on_request: undefined,
  gf_substitutes: undefined,
};

describe("deriveStepperNodes", () => {
  it("marks the current step and leaves the rest todo at the start", () => {
    const nodes = deriveStepperNodes(0, false, NO_ANSWERS);
    expect(nodes).toHaveLength(7);
    expect(nodes[0]).toMatchObject({ label: "Find the place", status: "current" });
    expect(nodes.slice(1).every((node) => node.status === "todo")).toBe(true);
  });

  it("derives done / skipped / current / todo from answers + position", () => {
    const answers: AnswerMap = {
      celiac_safe_vs_gluten_friendly: "confirm",
      dedicated_fryer: "skip",
      dedicated_gf_menu: undefined,
      off_menu_gf_on_request: undefined,
      gf_substitutes: undefined,
    };
    // On step 3 (dedicated_gf_menu) with a place chosen.
    const nodes = deriveStepperNodes(3, true, answers);
    expect(nodes[0]?.status).toBe("done"); // place chosen
    expect(nodes[1]?.status).toBe("done"); // headline confirmed
    expect(nodes[2]?.status).toBe("skipped"); // dedicated_fryer skipped
    expect(nodes[3]?.status).toBe("current"); // on this step
    expect(nodes[4]?.status).toBe("todo"); // untouched
    expect(nodes[6]?.status).toBe("todo"); // review
  });

  it("does not treat a skip as an alarming state (distinct from todo/done)", () => {
    const answers: AnswerMap = { ...NO_ANSWERS, celiac_safe_vs_gluten_friendly: "skip" };
    const nodes = deriveStepperNodes(0, true, answers);
    expect(nodes[1]?.status).toBe("skipped");
  });
});

describe("ProgressStepper", () => {
  it("announces the current step in a polite live region", () => {
    render(<ProgressStepper step={1} hasPlace answers={NO_ANSWERS} onNavigate={vi.fn()} />);
    const status = screen.getByText(/Step 2 of 7 · Celiac-safe/);
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("gates forward navigation until a place is chosen", () => {
    const onNavigate = vi.fn();
    render(
      <ProgressStepper step={0} hasPlace={false} answers={NO_ANSWERS} onNavigate={onNavigate} />
    );
    // The review node (forward) is disabled with no place.
    const reviewNode = screen.getByRole("button", { name: /Step 7: Review/ });
    expect(reviewNode).toBeDisabled();
  });

  it("lets a chosen place unlock forward jumps", () => {
    const onNavigate = vi.fn();
    render(<ProgressStepper step={0} hasPlace answers={NO_ANSWERS} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /Step 7: Review/ }));
    expect(onNavigate).toHaveBeenCalledWith(6);
  });
});
