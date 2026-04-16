import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Greeting } from "./Greeting";

describe("Greeting", () => {
  it("renders a personalised greeting", () => {
    render(<Greeting name="Alice" />);
    expect(screen.getByText("Hello, Alice!")).toBeInTheDocument();
  });

  it("renders a default greeting when no name is provided", () => {
    render(<Greeting />);
    expect(screen.getByText("Hello, World!")).toBeInTheDocument();
  });
});
