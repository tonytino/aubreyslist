/**
 * Places CAPTURE for the Denver seed: `pnpm db:seed:refresh` (AUB-31).
 *
 * This is the ONLY script that talks to the Google Places API. It reads the
 * human-curated `SEED_SOURCES` (`scripts/seed-sources.ts`), resolves each `query`
 * to a REAL Google Place ID + coordinates (+ rating) via Places Text Search
 * (biased to Union Station, hard-capped at a 25-mile radius), and BAKES the
 * fully-resolved entries to `scripts/seed-listings.generated.json`. That committed
 * file is what the API-free `pnpm db:seed` (`scripts/seed.ts`) inserts — so seeding
 * (including in production/CI) never calls Places.
 *
 * Run this ONCE (and re-run whenever you curate `seed-sources.ts`, or add a new
 * captured field here), then commit the regenerated JSON.
 *
 * Design (mirrors `scripts/seed-admin.ts` / `scripts/seed.ts`):
 * - The testable core is {@link refreshSeedData}, which takes its sources + a
 *   Places resolver as INJECTED dependencies so unit tests need no live network.
 * - The CLI shell ({@link runCli}) wires the real Text Search resolver, reads
 *   `GOOGLE_PLACES_API_KEY` through the validated `getEnv()` accessor (never raw
 *   `process.env`, per AGENTS.md Hard Rules), and writes the baked JSON.
 *
 * Runs via `node --experimental-strip-types` + the dependency-free alias loader
 * (`scripts/register-aliases.mjs`) — no `tsx`/`ts-node` dependency.
 */

import { writeFileSync } from "node:fs";
import { z } from "zod";
import { getEnv } from "~/env";
import { type Coords, UNION_STATION, haversineKm, milesToKm } from "~/listings/distance";
import type { SeededListing } from "./seed-data";
import { SEED_SOURCES, type SeedSource } from "./seed-sources";

/** A place resolved from a curated query — the fields a baked listing captures. */
export interface ResolvedPlace {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  googleRating?: number | null;
  googleRatingCount?: number | null;
}

/** Resolves a curated query to a real place, or `null` when it can't be seeded. */
export type PlaceResolver = (query: string) => Promise<ResolvedPlace | null>;

/** Dependencies for {@link refreshSeedData}; the CLI supplies the real ones. */
export interface RefreshSeedDataDeps {
  sources: SeedSource[];
  resolvePlace: PlaceResolver;
  /** Progress sink (defaults to a no-op so tests stay quiet). */
  log?: (message: string) => void;
}

/** What a refresh run produced: the baked listings + what it skipped. */
export interface RefreshSeedDataResult {
  listings: SeededListing[];
  skipped: Array<{ query: string; reason: string }>;
}

/** The 25-mile fan-out radius from Union Station (AUB-31 scope). */
const MAX_RADIUS_MILES = 25;

/**
 * Resolve every curated source to a baked {@link SeededListing}. Pure orchestration
 * over the injected resolver — no env/network of its own. Sources the resolver
 * can't place (unresolved / out-of-range) are recorded in `skipped`, not guessed.
 */
export async function refreshSeedData(deps: RefreshSeedDataDeps): Promise<RefreshSeedDataResult> {
  const { sources, resolvePlace, log = () => {} } = deps;

  const result: RefreshSeedDataResult = { listings: [], skipped: [] };

  for (const source of sources) {
    const place = await resolvePlace(source.query);
    if (place === null) {
      result.skipped.push({ query: source.query, reason: "unresolved-or-out-of-range" });
      log(`SKIP  ${source.query} — no in-range Places match`);
      continue;
    }

    result.listings.push({
      placeId: place.placeId,
      name: place.name,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      suggestedAttributes: source.suggestedAttributes,
      menuUrl: source.menuUrl ?? null,
      googleRating: place.googleRating ?? null,
      googleRatingCount: place.googleRatingCount ?? null,
    });
    log(`OK    ${place.name} — captured`);
  }

  return result;
}

// Places API (New) Text Search — one call resolves a query to id + name + address
// + coordinates + rating (no separate details call). We validate only what we bake.
const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const SEARCH_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount";

const searchTextResponseSchema = z.object({
  places: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.object({ text: z.string() }).optional(),
        formattedAddress: z.string().optional(),
        location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
        rating: z.number().optional(),
        userRatingCount: z.number().optional(),
      })
    )
    .optional(),
});

/**
 * Build the real Places Text Search resolver. Biases results toward Union Station
 * (so "Marco's" resolves to the Denver one) and REJECTS anything beyond the
 * 25-mile fan-out radius, returning `null` (skip + log) for any miss rather than
 * guessing. Deliberately un-gated by intake mode — this is an admin batch, not the
 * user intake flow, so it must not be blocked by an admin `manual` toggle.
 */
export function makePlacesResolver(
  apiKey: string,
  log: (message: string) => void = () => {}
): PlaceResolver {
  return async (query) => {
    let raw: unknown;
    try {
      const res = await fetch(PLACES_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": SEARCH_FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery: query,
          regionCode: "US",
          maxResultCount: 1,
          locationBias: {
            circle: {
              center: { latitude: UNION_STATION.lat, longitude: UNION_STATION.lng },
              radius: 40000, // ~25 mi, in metres — a bias, enforced hard below
            },
          },
        }),
      });
      if (!res.ok) {
        log(`Places searchText ${res.status} for "${query}"`);
        return null;
      }
      raw = await res.json();
    } catch (err) {
      log(
        `Places network error for "${query}": ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    }

    const parsed = searchTextResponseSchema.safeParse(raw);
    const place = parsed.success ? parsed.data.places?.[0] : undefined;
    if (!place || !place.location || place.formattedAddress === undefined) {
      return null;
    }

    const coords: Coords = { lat: place.location.latitude, lng: place.location.longitude };
    if (haversineKm(UNION_STATION, coords) > milesToKm(MAX_RADIUS_MILES)) {
      log(`OUT-OF-RANGE "${query}" (> ${MAX_RADIUS_MILES} mi from Union Station)`);
      return null;
    }

    return {
      placeId: place.id,
      name: place.displayName?.text ?? query,
      address: place.formattedAddress,
      lat: coords.lat,
      lng: coords.lng,
      googleRating: place.rating ?? null,
      googleRatingCount: place.userRatingCount ?? null,
    };
  };
}

/** Where the baked JSON lives (committed, consumed by `scripts/seed-data.ts`). */
const OUTPUT_URL = new URL("./seed-listings.generated.json", import.meta.url);

/**
 * CLI shell: wire the real Places resolver, run {@link refreshSeedData} over
 * `SEED_SOURCES`, and write the baked result to `seed-listings.generated.json`.
 * Kept thin; all real logic is in the injectable core. Reads
 * `GOOGLE_PLACES_API_KEY` through the validated `getEnv()` accessor only.
 *
 * Exit codes: `0` success, `1` any failure (missing key, network/write error).
 */
export async function runCli(
  deps?: Partial<RefreshSeedDataDeps>,
  log: Pick<Console, "log" | "error"> = console
): Promise<number> {
  try {
    const resolvePlace =
      deps?.resolvePlace ??
      (() => {
        const apiKey = getEnv().GOOGLE_PLACES_API_KEY;
        if (apiKey === undefined || apiKey.length === 0) {
          throw new Error(
            "GOOGLE_PLACES_API_KEY is required to refresh the seed data. Set it and re-run."
          );
        }
        return makePlacesResolver(apiKey, (m) => log.log(m));
      })();

    const sources = deps?.sources ?? SEED_SOURCES;
    const result = await refreshSeedData({
      sources,
      resolvePlace,
      log: deps?.log ?? ((m) => log.log(m)),
    });

    // Guard against a wholesale failure silently wiping the committed bake: if we
    // had sources but resolved NOTHING (e.g. a bad/expired/quota'd API key makes
    // every Places call fail — the resolver returns null, not throws), do NOT
    // overwrite `seed-listings.generated.json` with `[]`. Fail loudly instead so a
    // green "refresh" can never blow away good data.
    if (sources.length > 0 && result.listings.length === 0) {
      throw new Error(
        `Refresh resolved 0 of ${sources.length} sources — refusing to overwrite the baked seed data with an empty set. Check GOOGLE_PLACES_API_KEY (auth/quota) and re-run.`
      );
    }

    writeFileSync(OUTPUT_URL, `${JSON.stringify(result.listings, null, 2)}\n`);

    log.log(
      `Refresh complete — captured ${result.listings.length} listing(s), skipped ${result.skipped.length}. Wrote seed-listings.generated.json.`
    );
    if (result.skipped.length > 0) {
      log.log(`Skipped: ${result.skipped.map((s) => s.query).join("; ")}`);
    }
    return 0;
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// Run when invoked directly (not when imported by tests). `getEnv()` — and thus
// GOOGLE_PLACES_API_KEY validation — is only touched on this path.
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
