/**
 * Client-safe Google Places intake contract: the Zod validators + inferred
 * input types for the Places server functions, plus the result/prediction
 * shapes the add-listing UI renders. Imports only `z` — no `~/db` / drizzle /
 * neon value import.
 *
 * Living here (not in the db-touching `~/server/places`) lets `places.fn.ts`
 * back its `.validator()`s — and `PlacesIntakeForm` type its query results —
 * without pulling the drizzle/neon graph into the `listings.new` client
 * chunk. `~/server/places` re-exports these so server code keeps one import
 * surface.
 */

import { z } from "zod";

/** A single autocomplete prediction surfaced to the add-listing UI. */
export interface PlacePrediction {
  placeId: string;
  description: string;
}

/** Structured, canonical place data resolved from a Place ID. */
export interface PlaceDetails {
  /** Canonical Google Place ID — the dedup key for a listing (ADR-008). */
  placeId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  /** Google Maps deep-link for the place. */
  mapsUrl: string;
}

export type PlacesErrorReason =
  | "intake_disabled" // admin flipped intake to manual (ADR-008 graceful degradation)
  | "missing_key" // GOOGLE_PLACES_API_KEY absent (optional env var; guard at use)
  | "upstream_error" // Places API returned a non-OK response
  | "network_error"; // fetch threw / response could not be parsed

/**
 * Discriminated result for both operations. `ok: true` carries data;
 * `ok: false` carries a friendly, typed reason. Raw upstream errors and the
 * API key are never surfaced — callers get a stable shape they can render.
 */
export type PlacesResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: PlacesErrorReason; message: string };

/** Validated input for an autocomplete query. */
export const autocompleteInputSchema = z.object({
  query: z.string().min(1, "query is required").max(256),
});
export type AutocompleteInput = z.infer<typeof autocompleteInputSchema>;

/** Validated input for a place-details lookup. */
export const placeDetailsInputSchema = z.object({
  placeId: z.string().min(1, "placeId is required"),
});
export type PlaceDetailsInput = z.infer<typeof placeDetailsInputSchema>;
