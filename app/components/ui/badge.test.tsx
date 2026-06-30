import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, badgeVariants } from "./badge";

describe("Badge", () => {
  it("renders its text as a span", () => {
    render(<Badge>New</Badge>);
    const badge = screen.getByText("New");
    expect(badge.tagName).toBe("SPAN");
    expect(badge).toHaveAttribute("data-slot", "badge");
  });

  it("applies the default variant classes", () => {
    render(<Badge>Default</Badge>);
    expect(screen.getByText("Default")).toHaveClass("bg-primary");
  });

  it("applies the secondary variant classes", () => {
    render(<Badge variant="secondary">Soft</Badge>);
    expect(screen.getByText("Soft")).toHaveClass("bg-secondary");
  });

  it("merges a custom className", () => {
    render(<Badge className="custom-badge">X</Badge>);
    expect(screen.getByText("X")).toHaveClass("custom-badge");
  });

  it("exposes badgeVariants for composition", () => {
    expect(badgeVariants({ variant: "outline" })).toContain("text-foreground");
  });
});
