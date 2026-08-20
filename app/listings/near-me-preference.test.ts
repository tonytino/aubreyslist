import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetsNearMe, readNearMePreference, writeNearMePreference } from "./near-me-preference";

/**
 * The device-local "Near me" opt-in flag. Storage access can throw (privacy
 * modes, a full store), and neither reading nor writing may break the
 * directory.
 */

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("near-me preference", () => {
  it("is off until it is written", () => {
    expect(readNearMePreference()).toBe(false);
  });

  it("round-trips the opt-in", () => {
    writeNearMePreference(true);
    expect(readNearMePreference()).toBe(true);
  });

  it("clears the opt-in", () => {
    writeNearMePreference(true);
    writeNearMePreference(false);
    expect(readNearMePreference()).toBe(false);
    expect(localStorage.getItem("near-me-sort")).toBeNull();
  });

  it("never stores coordinates", () => {
    writeNearMePreference(true);
    expect(localStorage.getItem("near-me-sort")).toBe("true");
  });

  it("reads a foreign value as off", () => {
    localStorage.setItem("near-me-sort", "maybe");
    expect(readNearMePreference()).toBe(false);
  });

  it("is off when reading throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readNearMePreference()).toBe(false);
  });

  it("swallows a throwing write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeNearMePreference(true)).not.toThrow();
  });

  it("swallows a throwing clear", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeNearMePreference(false)).not.toThrow();
  });
});

describe("forgetsNearMe", () => {
  it("forgets on a permission answer", () => {
    expect(forgetsNearMe("blocked")).toBe(true);
    expect(forgetsNearMe("denied")).toBe(true);
  });

  it("keeps the opt-in through a transient failure", () => {
    // A timeout or a browser without the API is not the visitor changing
    // their mind: the next visit should still try.
    expect(forgetsNearMe("error")).toBe(false);
    expect(forgetsNearMe("unavailable")).toBe(false);
  });
});
