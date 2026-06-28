import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import { appSettings } from "~/db/schema";
import { getEnv } from "~/env";
import { requireCurrentUser } from "~/server/auth/guards";
import { enforceWriteLimit } from "~/server/rate-limit";

/**
 * Server-side Google Places provider for the add-listing intake flow (ADR-008).
 *
 * Why server functions (not a Hono route): per `docs/agents/api.md`, the
 * decision rule turns on "could anything outside this app's frontend ever need
 * this data?" — the answer is no. Autocomplete + place details are consumed
 * *only* by the add-listing UI; there is no webhook / mobile / cron / third-party
 * consumer. That points squarely at Layer 1 server functions. They also keep the
 * `GOOGLE_PLACES_API_KEY` strictly server-side (never shipped to the client) and
 * need no new dependency — `fetch` + Zod cover the whole surface. (A Hono route
 * would have required `@hono/zod-validator` per api.md's "Do Not skip
 * zValidator" rule, which violates the no-new-deps hard rule.)
 *
 * The exported `autocompletePlaces` / `getPlaceDetails` server functions wrap the
 * plain, directly-unit-testable `runAutocomplete` / `runPlaceDetails` helpers so
 * tests can mock `fetch` without going through the server-fn transport.
 */

// ---------------------------------------------------------------------------
// Google Places API (New) — endpoints + constants
// ---------------------------------------------------------------------------

// Places API (New) REST endpoints. Both legacy and New are enabled on the
// project; we prefer New (richer, simpler JSON, no `&key=` in the query string —
// the key travels in the X-Goog-Api-Key header instead).
const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_URL_BASE = "https://places.googleapis.com/v1/places";

// Field mask for place details — request only what we persist on a listing.
// `id` is the canonical Place ID; the rest map onto `listings` columns.
const DETAILS_FIELD_MASK = "id,displayName,formattedAddress,location";

/** App-settings key whose value selects the active intake mode (ADR-008). */
const INTAKE_MODE_KEY = "intake_mode";

// ---------------------------------------------------------------------------
// Result types — typed, friendly, and never leaking the key or raw upstream errors
// ---------------------------------------------------------------------------

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

/**
 * Discriminated result for both operations. `ok: true` carries data; `ok: false`
 * carries a friendly, typed reason. We never surface raw upstream errors or the
 * API key — callers get a stable shape they can render.
 */
export type PlacesResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: PlacesErrorReason; message: string };

export type PlacesErrorReason =
  | "intake_disabled" // admin flipped intake to manual (ADR-008 graceful degradation)
  | "missing_key" // GOOGLE_PLACES_API_KEY absent (optional env var; guard at use)
  | "upstream_error" // Places API returned a non-OK response
  | "network_error"; // fetch threw / response could not be parsed

/** Build the canonical Google Maps deep-link for a Place ID. */
export function buildMapsUrl(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

// ---------------------------------------------------------------------------
// Intake mode + key guards
// ---------------------------------------------------------------------------

/**
 * Read the active intake mode from `app_settings`, defaulting to `places` when
 * the row is unset. This is a deliberately minimal read — the full reusable
 * app-settings / feature-flag system is a separate issue (ADR-008); here we just
 * fetch the single row with a sane default so a `manual` toggle short-circuits
 * the provider instead of calling (and being billed by) the Places API.
 */
async function getIntakeMode(): Promise<"places" | "manual"> {
  const rows = await getDb()
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, INTAKE_MODE_KEY))
    .limit(1);

  return rows[0]?.value === "manual" ? "manual" : "places";
}

/**
 * Resolve the server-only Places API key. It is an *optional* env var (set in
 * Vercel, absent locally/CI), so we guard at point of use and return a typed
 * `missing_key` result rather than making the env var required (which would
 * break CI where the secret is absent).
 */
function resolveApiKey(): string | undefined {
  return getEnv().GOOGLE_PLACES_API_KEY;
}

const intakeDisabledResult = {
  ok: false as const,
  reason: "intake_disabled" as const,
  message: "Places intake is disabled. Use the manual entry form to add this listing.",
};

const missingKeyResult = {
  ok: false as const,
  reason: "missing_key" as const,
  message: "Places search is unavailable right now. Please add this listing manually.",
};

// ---------------------------------------------------------------------------
// Upstream response schemas (validate what we actually use)
// ---------------------------------------------------------------------------

const autocompleteResponseSchema = z.object({
  suggestions: z
    .array(
      z.object({
        placePrediction: z
          .object({
            placeId: z.string(),
            text: z.object({ text: z.string() }).optional(),
          })
          .optional(),
      })
    )
    .optional(),
});

const detailsResponseSchema = z.object({
  id: z.string(),
  displayName: z.object({ text: z.string() }).optional(),
  formattedAddress: z.string().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
});

// ---------------------------------------------------------------------------
// Core operations (plain functions — directly unit-testable with a mocked fetch)
// ---------------------------------------------------------------------------

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

/**
 * Autocomplete: query string -> list of predictions (placeId + description).
 * Short-circuits when intake is `manual` or the key is missing; maps any
 * upstream/network failure to a friendly typed error.
 */
export async function runAutocomplete(
  input: AutocompleteInput
): Promise<PlacesResult<PlacePrediction[]>> {
  if ((await getIntakeMode()) === "manual") return intakeDisabledResult;

  const apiKey = resolveApiKey();
  if (!apiKey) return missingKeyResult;

  let raw: unknown;
  try {
    const res = await fetch(AUTOCOMPLETE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
      },
      body: JSON.stringify({ input: input.query }),
    });

    if (!res.ok) {
      // Log server-side for debugging; never return the raw body (may echo key/quota).
      console.error(`Places autocomplete failed: ${res.status} ${res.statusText}`);
      return {
        ok: false,
        reason: "upstream_error",
        message: "Place search is temporarily unavailable. Please try again.",
      };
    }

    raw = await res.json();
  } catch (err) {
    console.error("Places autocomplete network error:", err);
    return {
      ok: false,
      reason: "network_error",
      message: "Could not reach place search. Check your connection and try again.",
    };
  }

  const parsed = autocompleteResponseSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("Places autocomplete: unexpected response shape", parsed.error);
    return {
      ok: false,
      reason: "upstream_error",
      message: "Place search returned an unexpected result. Please try again.",
    };
  }

  const predictions: PlacePrediction[] = (parsed.data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => p != null)
    .map((p) => ({ placeId: p.placeId, description: p.text?.text ?? "" }));

  return { ok: true, data: predictions };
}

/**
 * Place details: place_id -> name, formatted address, lat, lng, canonical Place
 * ID, and a Maps deep-link URL. Same guards and error mapping as autocomplete.
 */
export async function runPlaceDetails(
  input: PlaceDetailsInput
): Promise<PlacesResult<PlaceDetails>> {
  if ((await getIntakeMode()) === "manual") return intakeDisabledResult;

  const apiKey = resolveApiKey();
  if (!apiKey) return missingKeyResult;

  const url = `${DETAILS_URL_BASE}/${encodeURIComponent(input.placeId)}`;

  let raw: unknown;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": DETAILS_FIELD_MASK,
      },
    });

    if (!res.ok) {
      console.error(`Places details failed: ${res.status} ${res.statusText}`);
      return {
        ok: false,
        reason: "upstream_error",
        message: "Could not load place details. Please try again.",
      };
    }

    raw = await res.json();
  } catch (err) {
    console.error("Places details network error:", err);
    return {
      ok: false,
      reason: "network_error",
      message: "Could not reach place search. Check your connection and try again.",
    };
  }

  const parsed = detailsResponseSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.location || !parsed.data.formattedAddress) {
    console.error(
      "Places details: missing/unexpected fields",
      parsed.success ? null : parsed.error
    );
    return {
      ok: false,
      reason: "upstream_error",
      message: "Place details came back incomplete. Please try a different result.",
    };
  }

  const { id, displayName, formattedAddress, location } = parsed.data;
  return {
    ok: true,
    data: {
      placeId: id,
      name: displayName?.text ?? "",
      formattedAddress,
      lat: location.latitude,
      lng: location.longitude,
      mapsUrl: buildMapsUrl(id),
    },
  };
}

// ---------------------------------------------------------------------------
// Server-function wrappers — the entry points the add-listing UI calls
// ---------------------------------------------------------------------------

/**
 * Both wrappers proxy the *paid* Google Places API, so — like every write path
 * (ADR-010, issue #18) — they must reject anonymous callers and meter authed
 * ones BEFORE any upstream call, or an anonymous client could drive unbounded
 * billed usage (cost/quota DoS, issue #86). The only caller is the signed-in
 * add-listing intake form, so gating on auth is product-correct.
 *
 * Order of operations (mirrors `createListing`):
 * 1. {@link requireCurrentUser} — auth gate (throws 401 if anonymous).
 * 2. {@link enforceWriteLimit} — per-user rate limit (throws 429 over the cap),
 *    applied AFTER the auth gate and BEFORE the upstream Places call so an
 *    abusive burst is capped while anonymous callers still get a 401, not a 429.
 *    We reuse the shared write limiter; a separate tighter bucket is a possible
 *    follow-up, not required here.
 */

/** Autocomplete server function (validated input). See `runAutocomplete`. */
export const autocompletePlaces = createServerFn({ method: "POST" })
  .validator(autocompleteInputSchema)
  .handler(async ({ data }) => {
    const user = await requireCurrentUser();
    await enforceWriteLimit(user.id);
    return runAutocomplete(data);
  });

/** Place-details server function (validated input). See `runPlaceDetails`. */
export const getPlaceDetails = createServerFn({ method: "POST" })
  .validator(placeDetailsInputSchema)
  .handler(async ({ data }) => {
    const user = await requireCurrentUser();
    await enforceWriteLimit(user.id);
    return runPlaceDetails(data);
  });
