import { useCallback, useState } from "react";
import { type Coords, coordsSchema } from "~/listings/distance";

/**
 * One-shot browser geolocation request for the "near me" distance sort (#37).
 *
 * CLIENT-ONLY hook (uses `navigator.geolocation` + React state). It is the single
 * place the distance flow asks for the user's location, with a GRACEFUL FALLBACK
 * contract the route relies on:
 *
 *  - We DO NOT request location on mount — only when the caller invokes
 *    {@link GeolocationState.request} (i.e. the user opted into the distance
 *    sort). No surprise permission prompt on page load.
 *  - If geolocation is unavailable (no `navigator.geolocation`, e.g. SSR or an
 *    old browser), denied, errored, or times out, we resolve to an
 *    `{ status: "error" }` with an accessible message — never throw, never hang —
 *    so the caller can fall back to the default sort.
 *  - On success we resolve to validated {@link Coords} (WGS84-range-checked via
 *    the shared `coordsSchema`), so a bogus reading can't reach the distance sort.
 *
 * The hook resolves the returned promise to the outcome so the caller can act
 * (navigate to `sort=distance` with coords, or revert) without wiring effects.
 */

/** The current state of the geolocation request. */
export type GeolocationStatus = "idle" | "prompting" | "success" | "error";

/** The outcome of a single {@link GeolocationState.request} call. */
export type GeolocationResult =
  | { status: "success"; coords: Coords }
  | { status: "error"; message: string };

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
  "Location isn’t available in this browser. Showing listings alphabetically instead.";
const DENIED_MESSAGE =
  "Location access was denied. Showing listings alphabetically instead. " +
  "Enable location in your browser to sort by distance.";
const GENERIC_MESSAGE = "Couldn’t get your location. Showing listings alphabetically instead.";

function messageForError(error: GeolocationPositionError): string {
  // `PERMISSION_DENIED` is 1 in the spec; guard the constant in case it's absent.
  return error.code === error.PERMISSION_DENIED ? DENIED_MESSAGE : GENERIC_MESSAGE;
}

export function useGeolocation(): GeolocationState {
  const [status, setStatus] = useState<GeolocationStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const request = useCallback((): Promise<GeolocationResult> => {
    // Unavailable (SSR, old browser, or a locked-down context). Fall back, don't
    // throw — the caller reverts to the default sort.
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("error");
      setError(UNAVAILABLE_MESSAGE);
      return Promise.resolve({ status: "error", message: UNAVAILABLE_MESSAGE });
    }

    setStatus("prompting");
    setError(null);

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
            resolve({ status: "error", message: GENERIC_MESSAGE });
            return;
          }
          setStatus("success");
          setError(null);
          resolve({ status: "success", coords: parsed.data });
        },
        (positionError) => {
          const message = messageForError(positionError);
          setStatus("error");
          setError(message);
          resolve({ status: "error", message });
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
