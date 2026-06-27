import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Wordmark } from "./Wordmark";

describe("Wordmark", () => {
  it("renders the 'Aubrey's List' brand text", () => {
    render(<Wordmark />);
    expect(screen.getByText(/Aubrey's/)).toBeInTheDocument();
    expect(screen.getByText("List")).toBeInTheDocument();
  });

  it("hides the decorative mark from assistive tech", () => {
    const { container } = render(<Wordmark />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("applies size and consumer classes", () => {
    const { container } = render(<Wordmark size="lg" className="ml-2" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("text-headline");
    expect(root.className).toContain("ml-2");
  });
});
