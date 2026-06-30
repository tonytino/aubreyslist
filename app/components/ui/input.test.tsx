import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./input";

describe("Input", () => {
  it("renders an input and forwards the value", () => {
    render(<Input defaultValue="hello" aria-label="greeting" />);
    expect(screen.getByLabelText("greeting")).toHaveValue("hello");
  });

  it("forwards the disabled attribute", () => {
    render(<Input disabled aria-label="locked" />);
    expect(screen.getByLabelText("locked")).toBeDisabled();
  });

  it("forwards the type and placeholder", () => {
    render(<Input type="email" placeholder="you@example.com" />);
    const input = screen.getByPlaceholderText("you@example.com");
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("data-slot", "input");
  });

  it("merges a custom className", () => {
    render(<Input className="custom-input" aria-label="named" />);
    expect(screen.getByLabelText("named")).toHaveClass("custom-input");
  });
});
