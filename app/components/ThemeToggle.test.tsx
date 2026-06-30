import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

function fireClick(element: HTMLElement) {
  fireEvent.click(element);
}

beforeEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

describe("ThemeToggle", () => {
  it("shows the Moon (go-dark) action when light is applied", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "Switch to dark theme" });
    expect(button).toBeInTheDocument();
  });

  it("shows the Sun (go-light) action when dark is already applied on mount", () => {
    document.documentElement.classList.add("dark");
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
  });

  it("adds the dark class and persists 'dark' on toggle from light", () => {
    render(<ThemeToggle />);
    fireClick(screen.getByRole("button", { name: "Switch to dark theme" }));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
    // aria-label flips to reflect the new action.
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
  });

  it("removes the dark class and persists 'light' on toggle from dark", () => {
    document.documentElement.classList.add("dark");
    render(<ThemeToggle />);
    fireClick(screen.getByRole("button", { name: "Switch to light theme" }));

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();
  });

  it("reconciles to the applied theme after mount when .dark is pre-applied (no stale 'light')", () => {
    // Simulates the no-FOUC script having added `.dark` before hydration. The
    // component initializes to "light" (matching the server render), then the
    // post-mount effect reconciles. `render` flushes effects via act(), so by
    // the time we assert, the icon must reflect dark — the "Switch to light
    // theme" action with the Sun glyph, never the stale "Switch to dark theme".
    document.documentElement.classList.add("dark");
    const { container } = render(<ThemeToggle />);

    const button = screen.getByRole("button", { name: "Switch to light theme" });
    expect(button).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch to dark theme" })).toBeNull();
    // Sun icon (go-light action) is rendered, not Moon.
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("explicitly flushing the mount effect yields the Sun action for a dark-pre user", () => {
    document.documentElement.classList.add("dark");
    let utils: ReturnType<typeof render> | undefined;
    act(() => {
      utils = render(<ThemeToggle />);
    });
    expect(utils).toBeDefined();
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
  });

  it("round-trips across two toggles", () => {
    render(<ThemeToggle />);
    const get = () => screen.getByRole("button");

    fireClick(get()); // → dark
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    fireClick(get()); // → light
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
  });
});
