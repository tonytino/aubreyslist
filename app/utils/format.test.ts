import { describe, expect, it } from "vitest";
import { formatGreeting } from "./format";

describe("formatGreeting", () => {
  it("greets the given name", () => {
    expect(formatGreeting("Alice")).toBe("Hello, Alice!");
  });

  it("falls back to 'World' when no name is provided", () => {
    expect(formatGreeting()).toBe("Hello, World!");
  });

  it("falls back to 'World' for a whitespace-only name", () => {
    expect(formatGreeting("   ")).toBe("Hello, World!");
  });
});
