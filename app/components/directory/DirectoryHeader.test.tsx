import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DirectoryHeader } from "./DirectoryHeader";

/**
 * The directory toolbar row renders the location + community controls but NOT a
 * wordmark — the app-shell `SiteHeader` already brands the page, so rendering a
 * second "Aubrey's List" here would be a duplicate header (AUB-61 follow-up).
 */
describe("DirectoryHeader", () => {
  it("renders the location and community controls", () => {
    render(<DirectoryHeader />);
    expect(
      screen.getByRole("button", { name: /Change location — currently Denver, CO/ })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Community and profile" })).toBeInTheDocument();
    expect(screen.getByText("Denver, CO")).toBeInTheDocument();
  });

  it("does not render a duplicate wordmark (the site header already brands the page)", () => {
    render(<DirectoryHeader />);
    // No second "Aubrey's List" brand in the directory toolbar.
    expect(screen.queryByText(/Aubrey's List/)).not.toBeInTheDocument();
  });
});
