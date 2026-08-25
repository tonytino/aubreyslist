import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnswerMap, WizardPlace } from "./AddListingWizard";
import { ReviewStep } from "./ReviewStep";

/**
 * ReviewStep tests: headline confirm → celiac-safe SafetySignal chip; headline
 * dispute → plain muted "Disputed" text, no badge; fact confirm/dispute → a
 * per-attribute icon chip carrying the "Confirmed"/"Disputed" word in a neutral
 * (non-safety) tint; skip/untouched → "Not yet attested"; Edit jumps to the right
 * step.
 */

const PLACE: WizardPlace = { mode: "places", placeId: "p1", description: "Two Hands, Denver" };

function renderReview(
  answers: AnswerMap,
  overrides: Partial<Parameters<typeof ReviewStep>[0]> = {}
) {
  const props = {
    place: PLACE,
    answers,
    onEditPlace: vi.fn(),
    onEditAttribute: vi.fn(),
    onBack: vi.fn(),
    onSubmit: vi.fn(),
    submitting: false,
    ...overrides,
  };
  render(<ReviewStep {...props} />);
  return props;
}

describe("ReviewStep", () => {
  it("renders a SafetySignal chip for a confirmed headline attribute", () => {
    const { container } = renderReviewContainer({
      celiac_safe_vs_gluten_friendly: "confirm",
      dedicated_fryer: undefined,
      dedicated_gf_menu: undefined,
      off_menu_gf_on_request: undefined,
      gf_substitutes: undefined,
    });
    expect(container.querySelector('[data-safety-state="celiac-safe"]')).not.toBeNull();
  });

  it("renders a neutral fact chip (no safety chip) for a confirmed fact attribute", () => {
    const { container } = renderReviewContainer({
      celiac_safe_vs_gluten_friendly: undefined,
      dedicated_fryer: "confirm",
      dedicated_gf_menu: undefined,
      off_menu_gf_on_request: undefined,
      gf_substitutes: undefined,
    });
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    // No safety chip anywhere — the headline is untouched and the fact chip must
    // not borrow the celiac-safe safety colour.
    expect(container.querySelector("[data-safety-state]")).toBeNull();
  });

  it("renders plain muted text (no badge) for a disputed HEADLINE attribute", () => {
    // A disputed headline claim removes the badge; it never awards a lesser one,
    // so the review row must not promise a safety chip of any kind.
    const { container } = renderReviewContainer({
      celiac_safe_vs_gluten_friendly: "dispute",
      dedicated_fryer: undefined,
      dedicated_gf_menu: undefined,
      off_menu_gf_on_request: undefined,
      gf_substitutes: undefined,
    });
    expect(screen.getByText("Disputed")).toBeInTheDocument();
    expect(container.querySelector("[data-safety-state]")).toBeNull();
  });

  it("renders a neutral fact chip (no safety chip) for a disputed fact attribute", () => {
    const { container } = renderReviewContainer({
      celiac_safe_vs_gluten_friendly: undefined,
      dedicated_fryer: undefined,
      dedicated_gf_menu: "dispute",
      off_menu_gf_on_request: undefined,
      gf_substitutes: undefined,
    });
    expect(screen.getByText("Disputed")).toBeInTheDocument();
    expect(container.querySelector("[data-safety-state]")).toBeNull();
  });

  it("shows 'Not yet attested' for skipped and untouched attributes", () => {
    renderReview({
      celiac_safe_vs_gluten_friendly: "skip",
      dedicated_fryer: undefined,
      dedicated_gf_menu: undefined,
      off_menu_gf_on_request: undefined,
      gf_substitutes: undefined,
    });
    // Every one of the five attributes reads "Not yet attested".
    expect(screen.getAllByText("Not yet attested")).toHaveLength(5);
  });

  it("edits jump to the right step for a place and an attribute", () => {
    const props = renderReview({
      celiac_safe_vs_gluten_friendly: "confirm",
      dedicated_fryer: undefined,
      dedicated_gf_menu: undefined,
      off_menu_gf_on_request: undefined,
      gf_substitutes: undefined,
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit selected place" }));
    expect(props.onEditPlace).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Edit Dedicated fryer" }));
    expect(props.onEditAttribute).toHaveBeenCalledWith("dedicated_fryer");
  });

  it("submits via the primary button", () => {
    const props = renderReview({
      celiac_safe_vs_gluten_friendly: "confirm",
      dedicated_fryer: undefined,
      dedicated_gf_menu: undefined,
      off_menu_gf_on_request: undefined,
      gf_substitutes: undefined,
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit listing" }));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });
});

/** Variant of {@link renderReview} that also returns the render container. */
function renderReviewContainer(answers: AnswerMap) {
  return render(
    <ReviewStep
      place={PLACE}
      answers={answers}
      onEditPlace={vi.fn()}
      onEditAttribute={vi.fn()}
      onBack={vi.fn()}
      onSubmit={vi.fn()}
      submitting={false}
    />
  );
}
