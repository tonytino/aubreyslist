import { afterEach, describe, expect, it, vi } from "vitest";
import { googleMapsBrowserKey } from "./public-env";

/**
 * The accessor's contract is the graceful-degradation seam for the directory
 * map (AUB-111): absent/blank → `null`, so callers MUST handle the
 * unprovisioned case (CI/E2E run keyless and rely on the fallback path).
 */
describe("googleMapsBrowserKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when the variable is absent (the CI/E2E default)", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_BROWSER_KEY", undefined);
    expect(googleMapsBrowserKey()).toBeNull();
  });

  it("returns null for blank/whitespace values (an empty .env line is 'unprovisioned')", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_BROWSER_KEY", "");
    expect(googleMapsBrowserKey()).toBeNull();
    vi.stubEnv("VITE_GOOGLE_MAPS_BROWSER_KEY", "   ");
    expect(googleMapsBrowserKey()).toBeNull();
  });

  it("returns the trimmed key when provisioned", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_BROWSER_KEY", "  AIza-test-key  ");
    expect(googleMapsBrowserKey()).toBe("AIza-test-key");
  });
});
