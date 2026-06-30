import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, buttonVariants } from "./button";

describe("Button", () => {
  it("renders a button with its label", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("applies the default variant brand classes", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("bg-primary");
  });

  it("applies size and variant classes", () => {
    render(
      <Button variant="outline" size="sm">
        Tiny
      </Button>
    );
    const btn = screen.getByRole("button", { name: "Tiny" });
    expect(btn).toHaveClass("border-input", "h-8");
  });

  it("renders the child element when asChild is set", () => {
    render(
      <Button asChild>
        <a href="/listings">Browse</a>
      </Button>
    );
    const link = screen.getByRole("link", { name: "Browse" });
    expect(link).toHaveAttribute("href", "/listings");
    expect(link).toHaveAttribute("data-slot", "button");
  });

  it("exposes buttonVariants for composition", () => {
    expect(buttonVariants({ variant: "ghost" })).toContain("hover:bg-accent");
  });
});
