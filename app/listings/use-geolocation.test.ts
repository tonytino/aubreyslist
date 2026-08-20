import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geolocationPermission, useGeolocation } from "./use-geolocation";

/**
 * The grant / deny / unavailable fallback behaviour the distance sort depends
 * on. `navigator.geolocation` is mocked so the grant and deny paths are
 * deterministic.
 */

type SuccessCb = (position: GeolocationPosition) => void;
type ErrorCb = (error: GeolocationPositionError) => void;

const originalGeolocation = navigator.geolocation;
const originalPermissions = navigator.permissions;

function mockPermissions(state: PermissionState | "throws"): void {
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: {
      query: () =>
        state === "throws"
          ? Promise.reject(new TypeError("geolocation is not a valid PermissionName"))
          : Promise.resolve({ state }),
    },
  });
}

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
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: originalPermissions,
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

    expect(outcome).toMatchObject({ status: "error", reason: "denied" });
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

    expect(outcome).toMatchObject({ status: "error", reason: "error" });
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

    expect(outcome).toMatchObject({ status: "error", reason: "unavailable" });
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

    expect(outcome).toMatchObject({ status: "error", reason: "error" });
    expect(result.current.status).toBe("error");
  });

  it("reports a blocked browser without requesting, when the grant is already denied", async () => {
    const getCurrentPosition = vi.fn();
    mockGeolocation({ getCurrentPosition });
    mockPermissions("denied");

    const { result } = renderHook(() => useGeolocation());

    let outcome: Awaited<ReturnType<typeof result.current.request>> | undefined;
    await act(async () => {
      outcome = await result.current.request();
    });

    // No prompt can appear, so we never ask — and the message names the
    // browser setting instead of implying the user declined a prompt.
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "error", reason: "blocked" });
    expect(result.current.error).toMatch(/blocks location for this site/i);
    expect(result.current.error).toMatch(/browser settings/i);
  });

  it("still requests when the grant is pending (the prompt is coming)", async () => {
    mockPermissions("prompt");
    mockGeolocation({
      getCurrentPosition: (success) => success(makePosition(39.7392, -104.9903)),
    });

    const { result } = renderHook(() => useGeolocation());

    let outcome: Awaited<ReturnType<typeof result.current.request>> | undefined;
    await act(async () => {
      outcome = await result.current.request();
    });

    expect(outcome).toEqual({ status: "success", coords: { lat: 39.7392, lng: -104.9903 } });
  });

  it("still requests when the Permissions API rejects the geolocation name", async () => {
    mockPermissions("throws");
    mockGeolocation({
      getCurrentPosition: (success) => success(makePosition(39.7392, -104.9903)),
    });

    const { result } = renderHook(() => useGeolocation());

    let outcome: Awaited<ReturnType<typeof result.current.request>> | undefined;
    await act(async () => {
      outcome = await result.current.request();
    });

    expect(outcome?.status).toBe("success");
  });

  it("keeps the declined-prompt message when the request itself is denied", async () => {
    mockPermissions("prompt");
    mockGeolocation({
      getCurrentPosition: (_success, error) => error(makeError(1)),
    });

    const { result } = renderHook(() => useGeolocation());

    await act(async () => {
      await result.current.request();
    });

    expect(result.current.error).toMatch(/access was denied/i);
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

describe("geolocationPermission", () => {
  it("reads the stored grant when the Permissions API answers", async () => {
    mockPermissions("granted");
    await expect(geolocationPermission()).resolves.toBe("granted");
  });

  it("is unknown without a Permissions API", async () => {
    Object.defineProperty(navigator, "permissions", { configurable: true, value: undefined });
    await expect(geolocationPermission()).resolves.toBe("unknown");
  });

  it("is unknown when the query rejects", async () => {
    mockPermissions("throws");
    await expect(geolocationPermission()).resolves.toBe("unknown");
  });
});
