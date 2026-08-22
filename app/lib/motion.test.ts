import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion } from "./motion";

describe("prefersReducedMotion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to false when matchMedia is unavailable (SSR-safe)", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("reflects the reduced-motion media query", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true } as unknown as MediaQueryList);
    vi.stubGlobal("matchMedia", matchMedia);
    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");

    matchMedia.mockReturnValue({ matches: false } as unknown as MediaQueryList);
    expect(prefersReducedMotion()).toBe(false);
  });
});
