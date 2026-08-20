import { afterEach, describe, expect, it, vi } from "vitest";
import { errorMessage, logSkipped, runWhenInvokedDirectly } from "./cli";

/**
 * Tests for the shared CLI plumbing every `scripts/` command uses. Both helpers
 * are pure-ish and dependency-free, so this needs no DB, network, or env — but
 * `runWhenInvokedDirectly` does touch process-wide state (`argv`, `exitCode`),
 * so each test restores it or the runner's own exit code would be clobbered.
 */

const originalArgv = [...process.argv];
const originalExitCode = process.exitCode;

afterEach(() => {
  process.argv = [...originalArgv];
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe("errorMessage", () => {
  it("uses an Error's message", () => {
    expect(errorMessage(new Error("DATABASE_URL is required"))).toBe("DATABASE_URL is required");
  });

  it("stringifies a non-Error throw", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});

describe("logSkipped", () => {
  it("says nothing when a run skipped nothing", () => {
    const log = vi.fn();

    logSkipped(log, []);

    expect(log).not.toHaveBeenCalled();
  });

  it("joins the skipped queries into one line", () => {
    const log = vi.fn();

    logSkipped(log, [{ query: "Marco's" }, { query: "Root Down" }]);

    expect(log).toHaveBeenCalledWith("Skipped: Marco's; Root Down");
  });
});

describe("runWhenInvokedDirectly", () => {
  it("does not run main when the module is imported, not executed", () => {
    process.argv[1] = "/repo/scripts/seed.ts";
    const main = vi.fn(() => Promise.resolve(0));

    runWhenInvokedDirectly("file:///repo/scripts/seed.test.ts", main);

    expect(main).not.toHaveBeenCalled();
  });

  it("runs main and adopts its exit code when the module IS the entry point", async () => {
    process.argv[1] = "/repo/scripts/seed-admin.ts";

    runWhenInvokedDirectly("file:///repo/scripts/seed-admin.ts", () => Promise.resolve(2));

    await vi.waitFor(() => {
      expect(process.exitCode).toBe(2);
    });
  });

  it("reports a rejection and exits 1", async () => {
    process.argv[1] = "/repo/scripts/seed.ts";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    runWhenInvokedDirectly("file:///repo/scripts/seed.ts", () => Promise.reject(new Error("boom")));

    await vi.waitFor(() => {
      expect(process.exitCode).toBe(1);
    });
    expect(error).toHaveBeenCalledWith("boom");
  });
});
