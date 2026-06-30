import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./input";
import { Label } from "./label";

describe("Label", () => {
  it("renders its text content", () => {
    render(<Label>Email</Label>);
    expect(screen.getByText("Email")).toBeInTheDocument();
  });

  it("associates with an input via htmlFor", () => {
    render(
      <>
        <Label htmlFor="email">Email</Label>
        <Input id="email" aria-label="email-field" />
      </>
    );
    expect(screen.getByText("Email")).toHaveAttribute("for", "email");
    // Clicking the label focuses the associated control via getByLabelText.
    expect(screen.getByLabelText("Email")).toBe(screen.getByLabelText("email-field"));
  });

  it("merges a custom className", () => {
    render(<Label className="custom-label">Name</Label>);
    expect(screen.getByText("Name")).toHaveClass("custom-label");
  });
});
