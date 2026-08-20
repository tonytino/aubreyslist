/**
 * Device-local memory of the visitor's "Near me" opt-in.
 *
 * Not URL state: the flag is a per-device preference, not a shareable view.
 * The sort it restores still lands in the URL (`?sort=distance&lat=&lng=`), so
 * refresh, back/forward, and sharing keep working off the URL alone.
 *
 * Stores a flag, never coordinates. Every access is guarded: storage access
 * throws in some privacy modes, and a failure must never break the directory.
 */

import type { GeolocationFailure } from "~/listings/use-geolocation";

const STORAGE_KEY = "near-me-sort";

/**
 * Whether this device opted into the distance sort and hasn't since switched
 * away or been refused location.
 */
export function readNearMePreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Record (or clear) the opt-in. Silent on storage failure. */
export function writeNearMePreference(preferred: boolean): void {
  try {
    if (preferred) {
      globalThis.localStorage?.setItem(STORAGE_KEY, "true");
      return;
    }
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // A full or blocked store just means the preference doesn't persist.
  }
}

/**
 * Whether a failed location request should forget the opt-in. A permission
 * answer does; a timeout or a missing API is transient and must not silently
 * drop a preference the visitor set on purpose.
 */
export function forgetsNearMe(reason: GeolocationFailure): boolean {
  return reason === "blocked" || reason === "denied";
}
