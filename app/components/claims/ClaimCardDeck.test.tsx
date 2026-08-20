import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ClaimAttribute } from "~/listings/taxonomy";
import {
  ClaimCardDeck,
  type ClaimCardDeckProps,
  type DeckAnswerMap,
  emptyDeckAnswers,
} from "./ClaimCardDeck";

/**
 * ClaimCardDeck tests. The deck is presentational — no server module is
 * imported, so nothing is mocked. The button path is exercised throughout
 * (it is the equal-footing accessibility path and triggers the same
 * resolutions as the swipes; drag gestures aren't reproducible in jsdom).
 *
 * `MotionGlobalConfig.skipAnimations` makes every motion animation complete
 * instantly, so AnimatePresence card exits resolve synchronously under jsdom.
 */
beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Controlled host harness: owns the answer map exactly like both real hosts
 * do (the deck is controlled), records `onAnswer` calls, and folds each answer
 * back into the map.
 */
function Host({
  initial,
  onAnswerSpy,
  ...deckProps
}: {
  initial?: DeckAnswerMap;
  onAnswerSpy?: (attribute: ClaimAttribute, answer: string) => void;
} & Partial<Omit<ClaimCardDeckProps, "answers" | "onAnswer">>) {
  const [answers, setAnswers] = useState<DeckAnswerMap>(initial ?? emptyDeckAnswers());
  return (
    <ClaimCardDeck
      answers={answers}
      onAnswer={(attribute, answer) => {
        onAnswerSpy?.(attribute, answer);
        setAnswers((prev) => ({ ...prev, [attribute]: answer }));
      }}
      {...deckProps}
    />
  );
}

/** The deck's polite live region (sr-only, so text queries need the node). */
function liveRegion(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[aria-live="polite"]');
}

describe("ClaimCardDeck", () => {
  it("renders the headline card first: heading, description, safety preview, counter", () => {
    const { container } = render(<Host />);

    expect(screen.getByRole("heading", { name: "Celiac-safe" })).toBeInTheDocument();
    expect(screen.getByText(/kitchen takes cross-contamination seriously/)).toBeInTheDocument();
    // The headline-only "What your answer records" SafetySignal preview.
    expect(screen.getByText("What your answer records")).toBeInTheDocument();
    expect(container.querySelector('[data-safety-state="celiac-safe"]')).not.toBeNull();
    expect(container.querySelector('[data-safety-state="gluten-friendly"]')).not.toBeNull();
    // Text counter — never dots alone.
    expect(screen.getByText("Card 1 of 5")).toBeInTheDocument();
    // The next card peeks behind the top card, decoratively.
    expect(screen.getByTestId("peek-card")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows NO safety signal or preview on a fact card", () => {
    const { container } = render(<Host initialAttribute="dedicated_fryer" />);

    expect(screen.getByRole("heading", { name: "Dedicated fryer" })).toBeInTheDocument();
    expect(screen.queryByText("What your answer records")).not.toBeInTheDocument();
    expect(container.querySelector("[data-safety-state]")).toBeNull();
  });

  it("offers real, ≥44px Dispute / Not sure / Confirm buttons with icon + label", () => {
    render(<Host />);
    for (const name of ["Dispute", "Not sure", "Confirm"]) {
      const button = screen.getByRole("button", { name });
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
      expect(button.className).toContain("min-h-11");
      expect(button.querySelector("svg")).not.toBeNull();
    }
  });

  it("completes the whole flow on the button path, reporting every answer and skip", async () => {
    const onAnswerSpy = vi.fn();
    const onComplete = vi.fn();
    render(<Host onAnswerSpy={onAnswerSpy} onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByRole("heading", { name: "Dedicated fryer" });
    fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
    await screen.findByRole("heading", { name: "Dedicated GF menu" });
    fireEvent.click(screen.getByRole("button", { name: "Dispute" }));
    await screen.findByRole("heading", { name: "Off-menu GF on request" });
    fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
    await screen.findByRole("heading", { name: "GF substitutes" });
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(onAnswerSpy.mock.calls).toEqual([
      ["celiac_safe_vs_gluten_friendly", "confirm"],
      ["dedicated_fryer", "skip"],
      ["dedicated_gf_menu", "dispute"],
      ["off_menu_gf_on_request", "skip"],
      ["gf_substitutes", "confirm"],
    ]);
  });

  it("announces position + recorded answer in the polite live region", async () => {
    const { container } = render(<Host />);

    const region = liveRegion(container);
    expect(region).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(region).toHaveTextContent("Recorded: Confirm · Card 2 of 5 · Dedicated fryer");
    });

    fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
    await waitFor(() => {
      expect(region).toHaveTextContent("Recorded: Skipped · Card 3 of 5 · Dedicated GF menu");
    });
  });

  it("goes back to the previous card (and announces it) without recording anything", async () => {
    const onAnswerSpy = vi.fn();
    const { container } = render(<Host onAnswerSpy={onAnswerSpy} />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByRole("heading", { name: "Dedicated fryer" });
    onAnswerSpy.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "Celiac-safe" });
    expect(screen.getByText("Card 1 of 5")).toBeInTheDocument();
    expect(onAnswerSpy).not.toHaveBeenCalled();
    expect(liveRegion(container)).toHaveTextContent("Card 1 of 5 · Celiac-safe");
  });

  it("calls onBack from the first card, and hides Back there when the host passes none", () => {
    const onBack = vi.fn();
    const { unmount } = render(<Host onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    unmount();

    render(<Host />);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("seeds from the host's answer map (progress dots reflect prior answers)", () => {
    const initial: DeckAnswerMap = {
      ...emptyDeckAnswers(),
      celiac_safe_vs_gluten_friendly: "confirm",
      dedicated_fryer: "skip",
    };
    render(<Host initial={initial} initialAttribute="dedicated_gf_menu" />);
    // Starts at the requested card, with the counter reflecting position.
    expect(screen.getByText("Card 3 of 5")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dedicated GF menu" })).toBeInTheDocument();
  });

  it("shows the host's caption for a pre-voted card", () => {
    render(
      <Host
        cardCaption={(attribute) =>
          attribute === "celiac_safe_vs_gluten_friendly" ? "You marked this celiac-safe." : null
        }
      />
    );
    expect(screen.getByText("You marked this celiac-safe.")).toBeInTheDocument();
  });

  it("single-card Edit mode: one answer resolves straight back out (no forced re-march)", async () => {
    const onAnswerSpy = vi.fn();
    const onComplete = vi.fn();
    render(
      <Host
        onAnswerSpy={onAnswerSpy}
        onComplete={onComplete}
        initialAttribute="dedicated_gf_menu"
      />
    );

    // No peek card in single-card mode — there is no "next" to march to.
    expect(screen.queryByTestId("peek-card")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(onAnswerSpy).toHaveBeenCalledExactlyOnceWith("dedicated_gf_menu", "confirm");
    // It never advanced to card 4.
    expect(
      screen.queryByRole("heading", { name: "Off-menu GF on request" })
    ).not.toBeInTheDocument();
  });

  it("single-card Edit mode: Back resolves without recording an answer", () => {
    const onAnswerSpy = vi.fn();
    const onComplete = vi.fn();
    render(
      <Host onAnswerSpy={onAnswerSpy} onComplete={onComplete} initialAttribute="gf_substitutes" />
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onAnswerSpy).not.toHaveBeenCalled();
  });

  it("resolves to the deck-internal summary (showSummary) with the shared outcome chips", async () => {
    const onDone = vi.fn();
    const initial: DeckAnswerMap = {
      celiac_safe_vs_gluten_friendly: "confirm",
      dedicated_fryer: "dispute",
      dedicated_gf_menu: "skip",
      off_menu_gf_on_request: undefined,
      gf_substitutes: undefined,
    };
    const { container } = render(
      <Host initial={initial} initialAttribute="gf_substitutes" showSummary onDone={onDone} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const summary = await screen.findByRole("region", { name: "Your answers" });
    expect(summary).toBeInTheDocument();

    // Headline confirm → the real SafetySignal chip (colour + icon + label).
    expect(container.querySelector('[data-safety-state="celiac-safe"]')).not.toBeNull();
    // Fact outcomes → the shared FactOutcomeChip (neutral, never safety colours).
    expect(screen.getByTestId("fact-disputed")).toHaveTextContent("Disputed");
    expect(screen.getByTestId("fact-confirmed")).toHaveTextContent("Confirmed");
    // Skip and untouched → the honest dashed pill.
    expect(screen.getAllByText("Not yet attested")).toHaveLength(2);

    // Per-row Edit jumps back to that card, in single-card mode.
    fireEvent.click(screen.getByRole("button", { name: "Edit Dedicated GF menu" }));
    await screen.findByRole("heading", { name: "Dedicated GF menu" });
    expect(screen.getByText("Card 3 of 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    // Back on the summary with the edited answer, and Done closes.
    await screen.findByRole("region", { name: "Your answers" });
    expect(screen.getAllByTestId("fact-confirmed")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("stays fully operable under prefers-reduced-motion (fade branch)", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    try {
      const onComplete = vi.fn();
      render(<Host onComplete={onComplete} />);

      // Stamps still exist (icon + word — revealed at full opacity on press).
      expect(screen.getByTestId("swipe-stamp-confirm")).toHaveTextContent("Confirm");
      expect(screen.getByTestId("swipe-stamp-dispute")).toHaveTextContent("Dispute");

      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
      await screen.findByRole("heading", { name: "Dedicated fryer" });
      fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
      await screen.findByRole("heading", { name: "Dedicated GF menu" });
      fireEvent.click(screen.getByRole("button", { name: "Dispute" }));
      await screen.findByRole("heading", { name: "Off-menu GF on request" });
      fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
      await screen.findByRole("heading", { name: "GF substitutes" });
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalledTimes(1);
      });
    } finally {
      window.matchMedia = original;
    }
  });

  it("uses the branded WheatStrike (never a leaf) on the headline dispute affordances", () => {
    render(<Host />);
    const dispute = screen.getByRole("button", { name: "Dispute" });
    // WheatStrike is a bespoke glyph (no lucide- class); assert it is not a
    // generic lucide leaf and is present as an svg.
    const svg = dispute.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("class") ?? "").not.toContain("lucide-leaf");
  });
});
