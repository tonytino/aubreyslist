import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";

describe("Card", () => {
  it("renders the full card composition with content", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Aubrey's Diner</CardTitle>
          <CardDescription>Celiac-safe kitchen</CardDescription>
        </CardHeader>
        <CardContent>Dedicated fryer.</CardContent>
        <CardFooter>View listing</CardFooter>
      </Card>
    );
    expect(screen.getByText("Aubrey's Diner")).toBeInTheDocument();
    expect(screen.getByText("Celiac-safe kitchen")).toBeInTheDocument();
    expect(screen.getByText("Dedicated fryer.")).toBeInTheDocument();
    expect(screen.getByText("View listing")).toBeInTheDocument();
  });

  it("marks each part with its data-slot", () => {
    const { container } = render(
      <Card>
        <CardHeader>header</CardHeader>
      </Card>
    );
    expect(container.querySelector('[data-slot="card"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="card-header"]')).toBeInTheDocument();
  });

  it("merges a custom className onto the card root", () => {
    const { container } = render(<Card className="custom-card">x</Card>);
    expect(container.querySelector('[data-slot="card"]')).toHaveClass("custom-card");
  });
});
