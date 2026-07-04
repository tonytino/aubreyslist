import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ClaimAttestStep tests: the headline attribute shows the safety preview + safety
 * chips; a fact attribute shows NO safety signal; the control is CONTROLLED —
 * clicking a choice (including Skip) calls `onAnswer` and fires NO server write.
 */
const submitVoteMock = vi.fn((_args: unknown) => Promise.resolve({} as never));
vi.mock("~/server/attestations/attestations.fn", () => ({
  submitVote: (args: unknown) => submitVoteMock(args),
}));

import { ClaimAttestStep } from "./ClaimAttestStep";

afterEach(() => {
  vi.clearAllMocks();
});

describe("ClaimAttestStep", () => {
  it("shows the safety preview + chips on the headline attribute", () => {
    const { container } = render(
      <ClaimAttestStep
        attribute="celiac_safe_vs_gluten_friendly"
        value={undefined}
        onAnswer={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(screen.getByText(/What your answer records/)).toBeInTheDocument();
    // Both safety states are previewed via SafetySignal chips.
    expect(container.querySelector('[data-safety-state="celiac-safe"]')).not.toBeNull();
    expect(container.querySelector('[data-safety-state="gluten-friendly"]')).not.toBeNull();
  });

  it("shows NO safety signal on a fact attribute", () => {
    const { container } = render(
      <ClaimAttestStep
        attribute="dedicated_fryer"
        value={undefined}
        onAnswer={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(screen.queryByText(/What your answer records/)).not.toBeInTheDocument();
    expect(container.querySelector("[data-safety-state]")).toBeNull();
    // The authored fact helper is shown instead.
    expect(
      screen.getByText(/shared fryer oil is a major cross-contamination risk/)
    ).toBeInTheDocument();
  });

  it("sets 'skip' and calls onAnswer without any server write", () => {
    const onAnswer = vi.fn();
    render(
      <ClaimAttestStep
        attribute="dedicated_fryer"
        value={undefined}
        onAnswer={onAnswer}
        onBack={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Skip \(not sure\)/ }));
    expect(onAnswer).toHaveBeenCalledWith("skip");
    expect(submitVoteMock).not.toHaveBeenCalled();
  });

  it("relays confirm / dispute answers and still writes nothing", () => {
    const onAnswer = vi.fn();
    render(
      <ClaimAttestStep
        attribute="celiac_safe_vs_gluten_friendly"
        value={undefined}
        onAnswer={onAnswer}
        onBack={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    fireEvent.click(screen.getByRole("button", { name: /Dispute/ }));
    expect(onAnswer).toHaveBeenNthCalledWith(1, "confirm");
    expect(onAnswer).toHaveBeenNthCalledWith(2, "dispute");
    expect(submitVoteMock).not.toHaveBeenCalled();
  });
});
