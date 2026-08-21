import { useCallback, useState } from "react";
import { type Coords, coordsSchema } from "~/listings/distance";

/**
 * One-shot browser geolocation request for the "near me" distance sort.
 *
 * Client-only hook — the single place the distance flow asks for the user's
 * location, with a graceful-fallback contract the route relies on:
 *
 *  - Never requests location on mount — only when the caller invokes
 *    {@link GeolocationState.request}. No surprise permission prompt.
 *  - Checks {@link geolocationPermission} first: a browser that already holds a
 *    "denied" grant answers `getCurrentPosition` instantly with
 *    `PERMISSION_DENIED` and shows no prompt, so that case gets its own message
 *    naming the browser setting rather than blaming the user for declining.
 *  - Unavailable (no `navigator.geolocation`, e.g. SSR or an old browser),
 *    blocked, denied, errored, or timed out resolves to `{ status: "error" }`
 *    with an accessible message — never throws, never hangs — so the caller can
 *    fall back to the default sort.
 *  - Success resolves to validated {@link Coords} (WGS84-range-checked via
 *    the shared `coordsSchema`), so a bogus reading can't reach the sort.
 *
 * The returned promise resolves to the outcome so the caller can act
 * (navigate with coords, or revert) without wiring effects.
 */

/** The current state of the geolocation request. */
export type GeolocationStatus = "idle" | "prompting" | "success" | "error";

/**
 * Why a request failed. `blocked` (the browser holds a "denied" grant, so no
 * prompt appears) and `denied` (the visitor declined the prompt) are answers
 * about permission; `unavailable` and `error` (timeout, no fix, bogus reading)
 * are transient or environmental. Callers act on the difference: only a
 * permission answer should forget a remembered opt-in.
 */
export type GeolocationFailure = "unavailable" | "blocked" | "denied" | "error";

/** The outcome of a single {@link GeolocationState.request} call. */
export type GeolocationResult =
  | { status: "success"; coords: Coords }
  | { status: "error"; reason: GeolocationFailure; message: string };

export interface GeolocationState {
  status: GeolocationStatus;
  /** A human-readable, accessible message when `status === "error"`. */
  error: string | null;
  /** Request the user's location once. Safe to call repeatedly (re-prompts). */
  request: () => Promise<GeolocationResult>;
  /** Reset back to idle (e.g. when the user leaves the distance sort). */
  reset: () => void;
}

const UNAVAILABLE_MESSAGE =
  "Location isn’t available in this browser. Showing recently confirmed listings instead.";
const DENIED_MESSAGE =
  "Location access was denied, so we can’t sort by distance. " +
  "Showing recently confirmed listings instead.";
const BLOCKED_MESSAGE =
  "Your browser blocks location for this site, so no prompt appeared. " +
  "Showing recently confirmed listings. Allow location in your browser settings to sort by distance.";
const GENERIC_MESSAGE = "Couldn’t get your location. Showing recently confirmed listings instead.";

/**
 * The browser's stored geolocation grant, or `"unknown"` when it can't be read
 * (SSR, no Permissions API, or a browser whose `query` rejects the
 * `geolocation` name — Safari before 16.4 throws).
 *
 * Read-only: querying never prompts. Callers use it to tell an
 * already-blocked browser (no prompt is coming) from one that will ask.
 */
export async function geolocationPermission(): Promise<PermissionState | "unknown"> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "unknown";
  }
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state;
  } catch {
    return "unknown";
  }
}

function outcomeForError(error: GeolocationPositionError): {
  reason: GeolocationFailure;
  message: string;
} {
  // `PERMISSION_DENIED` is 1 in the spec; guard the constant in case it's absent.
  return error.code === error.PERMISSION_DENIED
    ? { reason: "denied", message: DENIED_MESSAGE }
    : { reason: "error", message: GENERIC_MESSAGE };
}

export function useGeolocation(): GeolocationState {
  const [status, setStatus] = useState<GeolocationStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (): Promise<GeolocationResult> => {
    // Unavailable (SSR, old browser, or a locked-down context). Fall back, don't
    // throw — the caller reverts to the default sort.
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("error");
      setError(UNAVAILABLE_MESSAGE);
      return { status: "error", reason: "unavailable", message: UNAVAILABLE_MESSAGE };
    }

    setStatus("prompting");
    setError(null);

    // Awaiting the permission read before requesting is safe: geolocation needs
    // no transient user activation, so the prompt still opens after the await.
    if ((await geolocationPermission()) === "denied") {
      setStatus("error");
      setError(BLOCKED_MESSAGE);
      return { status: "error", reason: "blocked", message: BLOCKED_MESSAGE };
    }

    return new Promise<GeolocationResult>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const parsed = coordsSchema.safeParse({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          if (!parsed.success) {
            setStatus("error");
            setError(GENERIC_MESSAGE);
            resolve({ status: "error", reason: "error", message: GENERIC_MESSAGE });
            return;
          }
          setStatus("success");
          setError(null);
          resolve({ status: "success", coords: parsed.data });
        },
        (positionError) => {
          const { reason, message } = outcomeForError(positionError);
          setStatus("error");
          setError(message);
          resolve({ status: "error", reason, message });
        },
        // Don't hang forever: time out and fall back rather than leaving the user
        // staring at an unchanged list with no feedback.
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
      );
    });
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
  }, []);

  return { status, error, request, reset };
}
