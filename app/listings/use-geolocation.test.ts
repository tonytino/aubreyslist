import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGeolocation } from "./use-geolocation";

/**
 * Tests for the "near me" geolocation hook (#37): the grant / deny / unavailable
 * fallback behaviour the distance sort depends on. We mock `navigator.geolocation`
 * so the grant and deny paths are deterministic (no real browser permission).
 */

type SuccessCb = (position: GeolocationPosition) => void;
type ErrorCb = (error: GeolocationPositionError) => void;

const originalGeolocation = navigator.geolocation;

function mockGeolocation(impl: {
  getCurrentPosition: (success: SuccessCb, error: ErrorCb) => void;
}) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: impl,
  });
}

function makePosition(lat: number, lng: number): GeolocationPosition {
  return {
    coords: {
      latitude: lat,
      longitude: lng,
      accuracy: 10,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON() {
        return {};
      },
    },
    timestamp: Date.now(),
    toJSON() {
      return {};
    },
  };
}

function makeError(code: number): GeolocationPositionError {
  return {
    code,
    message: "denied",
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as GeolocationPositionError;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: originalGeolocation,
  });
});

describe("useGeolocation", () => {
  it("starts idle and does NOT request location on mount", () => {
    const getCurrentPosition = vi.fn();
    mockGeolocation({ getCurrentPosition });

    const { result } = renderHook(() => useGeolocation());

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
    // No surprise permission prompt — nothing requested until the user opts in.
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("resolves to validated coords when the user grants permission", async () => {
    mockGeolocation({
      getCurrentPosition: (success) => success(makePosition(39.7392, -104.9903)),
    });

    const { result } = renderHook(() => useGeolocation());

    let outcome: Awaited<ReturnType<typeof result.current.request>> | undefined;
    await act(async () => {
      outcome = await result.current.request();
    });

    expect(outcome).toEqual({ status: "success", coords: { lat: 39.7392, lng: -104.9903 } });
    expect(result.current.status).toBe("success");
    expect(result.current.error).toBeNull();
  });

  it("falls back with a denied-specific message when permission is denied", async () => {
    mockGeolocation({
      getCurrentPosition: (_success, error) => error(makeError(1)), // PERMISSION_DENIED
    });

    const { result } = renderHook(() => useGeolocation());

    let outcome: Awaited<ReturnType<typeof result.current.request>> | undefined;
    await act(async () => {
      outcome = await result.current.request();
    });

    expect(outcome?.status).toBe("error");
    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatch(/denied/i);
    // The accessible message names the fallback so the user understands the result.
    expect(result.current.error).toMatch(/alphabetically/i);
  });

  it("falls back with a generic message on a non-permission error (timeout/unavailable)", async () => {
    mockGeolocation({
      getCurrentPosition: (_success, error) => error(makeError(3)), // TIMEOUT
    });

    const { result } = renderHook(() => useGeolocation());

    let outcome: Awaited<ReturnType<typeof result.current.request>> | undefined;
    await act(async () => {
      outcome = await result.current.request();
    });

    expect(outcome?.status).toBe("error");
    expect(result.current.error).toMatch(/couldn’t get your location/i);
  });

  it("falls back when geolocation is unavailable in the browser", async () => {
    // Remove the API entirely (old browser / locked-down context).
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useGeolocation());

    let outcome: Awaited<ReturnType<typeof result.current.request>> | undefined;
    await act(async () => {
      outcome = await result.current.request();
    });

    expect(outcome?.status).toBe("error");
    expect(result.current.error).toMatch(/isn’t available/i);
  });

  it("rejects an out-of-range reading as an error (validated coords)", async () => {
    mockGeolocation({
      getCurrentPosition: (success) => success(makePosition(999, 999)), // impossible
    });

    const { result } = renderHook(() => useGeolocation());

    let outcome: Awaited<ReturnType<typeof result.current.request>> | undefined;
    await act(async () => {
      outcome = await result.current.request();
    });

    expect(outcome?.status).toBe("error");
    expect(result.current.status).toBe("error");
  });

  it("reset() returns the hook to idle", async () => {
    mockGeolocation({
      getCurrentPosition: (_success, error) => error(makeError(1)),
    });

    const { result } = renderHook(() => useGeolocation());

    await act(async () => {
      await result.current.request();
    });
    expect(result.current.status).toBe("error");

    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
  });
});
