import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DirectorySearch } from "./DirectorySearch";

/**
 * Tests for the directory search field (AUB-61, Phase 2b). Typing reports the new
 * value; the clear (✕) button appears only when there's a query and resets it.
 */

describe("DirectorySearch", () => {
  it("renders an accessible search input whose placeholder promises only name/address", () => {
    render(<DirectorySearch value="" onChange={() => {}} />);
    const input = screen.getByRole("searchbox", { name: "Search listings" });
    expect(input).toHaveAttribute("placeholder", "Search restaurants by name or address");
  });

  it("reports each keystroke to onChange", () => {
    const onChange = vi.fn();
    render(<DirectorySearch value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "root" } });
    expect(onChange).toHaveBeenCalledWith("root");
  });

  it("hides the clear button while the query is empty", () => {
    render(<DirectorySearch value="" onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });

  it("shows a clear button when there's a query and resets on click", () => {
    const onChange = vi.fn();
    render(<DirectorySearch value="root" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
