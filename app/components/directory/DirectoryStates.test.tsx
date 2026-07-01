import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DirectoryEmpty, DirectoryNoResults, LoadingSkeletons } from "./DirectoryStates";

/**
 * Tests for the directory content states (AUB-61, Phase 2b). Each state renders
 * its bundle copy; the empty CTA applies the celiac quick filter and the
 * no-results CTA clears everything.
 */

describe("LoadingSkeletons", () => {
  it("renders four shimmer skeleton cards", () => {
    const { container } = render(<LoadingSkeletons />);
    // The skeleton bones carry the shimmer utility; four cards are rendered.
    expect(container.querySelectorAll("li")).toHaveLength(4);
    expect(container.querySelectorAll(".animate-shimmer").length).toBeGreaterThanOrEqual(4);
  });
});

describe("DirectoryEmpty", () => {
  it("renders the first-run headline and the celiac CTA", () => {
    const onBrowseCeliac = vi.fn();
    render(<DirectoryEmpty onBrowseCeliac={onBrowseCeliac} />);
    expect(
      screen.getByRole("heading", { name: "Let's find your safe table in Denver" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Browse celiac-safe spots/ }));
    expect(onBrowseCeliac).toHaveBeenCalledTimes(1);
  });
});

describe("DirectoryNoResults", () => {
  it("renders the no-results headline and the clear-all CTA", () => {
    const onClearAll = vi.fn();
    render(<DirectoryNoResults onClearAll={onClearAll} />);
    expect(
      screen.getByRole("heading", { name: "No spots match those filters" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});
