import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DirectoryEmpty, DirectoryNoResults } from "./DirectoryStates";

/**
 * Tests for the directory content states (AUB-61, Phase 2b). Each state renders
 * its bundle copy; the empty CTA applies the celiac quick filter and the
 * no-results CTA clears everything.
 */

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
